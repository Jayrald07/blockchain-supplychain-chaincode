'use strict';

const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class AssetTransfer extends Contract {
    async InitLedger(ctx) {
        const assets = [];

        for (const asset of assets) {
            asset.docType = 'asset';
            await ctx.stub.putState(asset.ID, Buffer.from(stringify(sortKeysRecursive(asset))));
        }
    }

    async VerifyClientMatchesPeer(ctx) {
        const clientMSPID = ctx.clientIdentity.getMSPID();
        const peerMSPID = ctx.stub.getMspID();

        if (clientMSPID !== peerMSPID) {
            throw new Error(`Client from org ${clientMSPID} has no privilege to handle private data from org ${peerMSPID} peer`);
        }

        return peerMSPID;
    }

    // ReadAsset returns the asset stored in the world state with given id.
    async ReadAsset(ctx, id) {
        const assetJSON = await ctx.stub.getState(id); // get the asset from chaincode state
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return assetJSON.toString();
    }

    // UpdateAsset updates an existing asset in the world state with provided parameters.
    async UpdateAsset(ctx, id, color, size, owner) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        // overwriting original asset with new asset
        const updatedAsset = {
            ID: id,
            Color: color,
            Size: size,
            Owner: owner,
        };
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        return ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(updatedAsset))));
    }

    // DeleteAsset deletes a given asset from the world state.
    async DeleteAsset(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return ctx.stub.deleteState(id);
    }

    // AssetExists returns true when asset with given ID exists in world state.
    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }

    // GetAllAssets returns all assets found in the world state.
    async GetAllAssets(ctx) {
        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }

    async GetAssetProvenance(ctx, ID) {
        const promiseOfIterator = ctx.stub.getHistoryForKey(ID);

        const results = [];
        for (const keyMod of promiseOfIterator) {
            const resp = {
                timestamp: keyMod.timestamp,
                txid: keyMod.txId
            };

            if (keyMod.isDelete) { resp.data = 'KEY DELETED'; }
            else { resp.data = keyMod.value.toString('utf8'); }
            results.push(resp);
        }
        return JSON.stringify(results);
    }

    async LogIt(ctx, description, action, assetIds) {
        try {
            const MSP = ctx.clientIdentity.getMSPID();

            const hash = await ctx.stub.getPrivateDataHash('assetCollection', 'activity');

            if (hash.length) {
                let bufferedActivities = await ctx.stub.getPrivateData("assetCollection", 'activity');

                let activities = JSON.parse(bufferedActivities.toString());
                let activity = { initiated: MSP, description, assetIds, action, timestamp: ctx.stub.getTxTimestamp().array[0] };

                await ctx.stub.putPrivateData("assetCollection", 'activity', JSON.stringify([activity, ...activities]))
            } else {
                let activity = { initiated: MSP, description, assetIds, action, timestamp: ctx.stub.getTxTimestamp().array[0] };

                await ctx.stub.putPrivateData("assetCollection", 'activity', JSON.stringify([activity]))
            }

            return { message: "Done", details: "Logged" };
        } catch (error) {
            return { message: "Error", details: error.message };
        }
    }

    GetLogsByMSP(activities, msp) {
        const logs = activities.filter(activity => activity.initiated === msp);
        return logs;
    }

    GetItemsByOffset(logs, start = 0, offset = 10) {
        if (logs.length <= start) return null;

        return logs.splice(start, offset);
    }

    async ReadLogs(ctx, msp, start = "0", offset = "10") {
        try {
            const hash = await ctx.stub.getPrivateDataHash('assetCollection', 'activity');

            if (hash.length) {
                start = parseInt(start);
                offset = parseInt(offset)
                let bufferedActivities = await ctx.stub.getPrivateData("assetCollection", 'activity');

                let activities = JSON.parse(bufferedActivities.toString());

                let _logs = this.GetLogsByMSP(activities, msp);

                let logs = null;

                if (offset > 0) logs = this.GetItemsByOffset(_logs, start, offset);
                else logs = _logs;

                return { message: "Done", details: { logs, count: _logs.length } };
            } else return { message: "Done", details: [] };

        } catch (error) {
            return { message: "Error", details: error.message }
        }
    }

    async CreatePrivateAsset(ctx, assetId, tags) {
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');
            const _tags = JSON.parse(tags);

            if (hash.length) {
                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([assetId, ...assets]))
            } else {
                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([assetId]))
            }

            await ctx.stub.putPrivateData(orgCollectionName.join(''), assetId, JSON.stringify({
                assetId,
                tags: _tags,
                history: [{
                    MSP,
                    timestamp: ctx.stub.getTxTimestamp().array[0]
                }]
            }))

            await this.LogIt(ctx, "New asset created", "CREATE ASSET", [assetId]);

            return JSON.stringify({ message: 'Done', details: `Asset ${assetId} created ` });
        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR CREATE ASSET", [assetId]);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async CreatePrivateTransaction(ctx, transactionId, assetIds, newOwnerMSP) {

        try {
            const _assetIds = JSON.parse(assetIds);

            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, 'transactions');

            const MSP = ctx.clientIdentity.getMSPID()

            let assetDetails = [];

            for (let _assetId of _assetIds) {
                let assetDetail = await this.ReadPrivateAsset(ctx, _assetId);
                let parsedAsset = JSON.parse(assetDetail);
                if (parsedAsset.message === "Done") assetDetails.push(parsedAsset.details);
            }

            await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify({ id: transactionId, assetIds: assetDetails, newOwnerMSP, isNewOwnerAccepted: false, isCurrentOwnerApproved: false }));

            if (hash.length) {
                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, 'transactions')

                let transactions = JSON.parse(bufferedTranscations.toString());

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }, ...transactions]))
            } else {
                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }]))
            }

            await this.LogIt(ctx, `Initiated transfer of asset/s to ${newOwnerMSP}`, "INITIATE TRANSACTION", _assetIds);

            return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} created` });
        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message });
        }

    }

    async ReadPrivateAssets(ctx) {
        try {
            const orgCollectionName = [ctx.clientIdentity.getMSPID(), 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');
            if (hash.length) {
                const bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets');
                const assets = JSON.parse(bufferedAssets.toString());

                return JSON.stringify({ message: 'Done', details: assets });
            } else return JSON.stringify({ message: 'Done', details: 'No assets' });

        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message })
        }
    }

    async ReadPrivateAsset(ctx, assetId) {
        const orgCollectionName = [ctx.clientIdentity.getMSPID(), 'PrivateCollection'];
        try {
            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), assetId);
            if (hash.length) {
                const bufferedAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), assetId);
                const asset = JSON.parse(bufferedAsset.toString());

                return JSON.stringify({ message: 'Done', details: asset });
            } else return JSON.stringify({ message: 'Error', details: `Asset ${assetId} cannot find` });
        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async ReadTransactions(ctx) {
        try {
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, 'transactions');

            if (hash.length) {
                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, 'transactions')
                let transactionDetails = [];
                let transactions = JSON.parse(bufferedTranscations.toString());

                for (let transaction of transactions) {
                    let transactionDetail = await this.ReadTransactionPrivateDetails(ctx, transaction.id);
                    transactionDetails.push(JSON.parse(transactionDetail));
                }

                return JSON.stringify(transactionDetails);

            } else { return JSON.stringify([]) };

        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async DeleteTransaction(ctx, transactionId) {
        try {
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, 'transactions');

            if (hash.length) {
                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, 'transactions')
                let transactions = JSON.parse(bufferedTranscations.toString());


                transactions.forEach((transaction, index) => {
                    if (transaction.id === transactionId) transactions.splice(index, 1);
                })

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([...transactions]))

                return { message: "Done", details: `Transaction ${transactionId} has been deleted` };
            }

            return { message: "Error", details: "No transactions available" }
        } catch (error) {
            return JSON.stringify({ message: "Error", details: error.message });
        }
    }

    async ReadTransactionPrivateDetails(ctx, transactionId) {
        try {
            const bufferedTranscations = await ctx.stub.getPrivateData('assetCollection', transactionId);

            const transaction = JSON.parse(bufferedTranscations.toString());

            return JSON.stringify(transaction);
        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async AcceptTransaction(ctx, transactionId) {

        try {

            const MSP = ctx.clientIdentity.getMSPID();

            const buffer = await ctx.stub.getPrivateData('assetCollection', transactionId);

            let transaction = JSON.parse(buffer.toString());

            if (MSP === transaction.newOwnerMSP) {
                transaction.isNewOwnerAccepted = true;

                await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                let assetIds = [];

                for (let asset of transaction.assetIds) {
                    assetIds.push(asset.assetId);
                }

                await this.LogIt(ctx, `${transaction.newOwnerMSP} accepted the transaction`, "ACCEPT TRANSACTION", assetIds);

                return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} accepted by ${MSP}` });
            } else {
                return JSON.stringify({ message: 'Error', details: 'You are not allowed to accept this transaction' });
            }

        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR ACCEPT TRANSACTION", []);
            return JSON.stringify({ message: 'Error', details: error.message });
        }

    }

    async TransferNow(ctx, transactionId) {

        try {
            const MSP = ctx.clientIdentity.getMSPID();

            const buffer = await ctx.stub.getPrivateData('assetCollection', transactionId);

            let transaction = JSON.parse(buffer.toString());

            if (MSP !== transaction.newOwnerMSP) {
                if (transaction.isNewOwnerAccepted) {

                    let bufferedAssets = await ctx.stub.getPrivateData([MSP, 'PrivateCollection'].join(''), 'assets');
                    let assets = JSON.parse(bufferedAssets.toString());

                    assets.forEach((asset, assetIndex) => {
                        transaction.assetIds.forEach((transactionAsset) => {
                            if (transactionAsset.assetId === asset) assets.splice(assetIndex, 1);
                        })
                    })

                    transaction.isCurrentOwnerApproved = true;

                    for (let asset of transaction.assetIds) {
                        await ctx.stub.deletePrivateData([MSP, 'PrivateCollection'].join(''), asset.assetId);
                    }

                    await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assets]));

                    await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                    await this.LogIt(ctx, `Transaction ${transactionId} assets has been changed ownership`, "TRANSFERRED", []);

                    return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} has been transferred` });
                } else {
                    return JSON.stringify({ message: 'Error', details: 'Cannot transfer: Receiver still not accepted the request' });
                }
            } else {
                return JSON.stringify({ message: 'Error', details: 'You are not allowed to process this transaction' })
            }
        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message });
        }

    }

    async OwnAsset(ctx, transactionId) {
        try {
            const MSP = ctx.clientIdentity.getMSPID();

            const bufferedTranscation = await ctx.stub.getPrivateData('assetCollection', transactionId);

            let transaction = JSON.parse(bufferedTranscation.toString());

            if (MSP === transaction.newOwnerMSP) {
                if (transaction.isCurrentOwnerApproved) {

                    let hash = await ctx.stub.getPrivateDataHash([MSP, 'PrivateCollection'].join(''), 'assets');

                    let assetIds = [];

                    for (let asset of transaction.assetIds) {
                        assetIds.push(asset.assetId)
                    }

                    if (hash.length) {
                        let bufferedAssets = await ctx.stub.getPrivateData([MSP, 'PrivateCollection'].join(''), 'assets');

                        let assets = JSON.parse(bufferedAssets.toString());

                        await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assetIds, ...assets]));

                    } else {
                        await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assetIds]));
                    }

                    for (let asset of transaction.assetIds) {
                        let _history = [{ MSP, timestamp: ctx.stub.getTxTimestamp().array[0] }, ...asset.history]
                        asset.history = _history;
                        await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), asset.assetId, JSON.stringify(asset));
                    }

                    await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                    await ctx.stub.deletePrivateData('assetCollection', transactionId);

                    await this.DeleteTransaction(ctx, transactionId);

                    await this.LogIt(ctx, `Transaction ${transactionId} assets has been fully transferred to ${transaction.newOwnerMSP}`, "OWNED", assetIds);

                    return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} transferred successfully` });

                } else { return JSON.stringify({ message: 'Error', details: 'Owner still not approved the transfer' }); }
            } else { return JSON.stringify({ message: 'Error', details: 'You are not allowed to own this asset' }); }
        } catch (error) {
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }
}

module.exports = AssetTransfer;
