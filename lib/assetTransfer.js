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
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash('assetCollection', 'activity');

            let assetsDetails = [];

            assetIds.forEach(async (assetId) => {
                let bufferedAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), assetId)
                let asset = JSON.parse(bufferedAsset.toString());
                assetsDetails.push(asset)
            })

            if (hash.length) {

                let bufferedActivities = await ctx.stub.getPrivateData("assetCollection", 'activity');

                let activities = JSON.parse(bufferedActivities.toString());

                let activity = { initiated: MSP, description, assets: assetsDetails, action, timestamp: ctx.stub.getTxTimestamp().array[0] };

                await ctx.stub.putPrivateData("assetCollection", 'activity', JSON.stringify([activity, ...activities]))

            } else {

                let activity = { initiated: MSP, description, assets: assetsDetails, action, timestamp: ctx.stub.getTxTimestamp().array[0] };

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

    async ReadLogs(ctx, start = "0", offset = "10") {
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const hash = await ctx.stub.getPrivateDataHash('assetCollection', 'activity');

            if (hash.length) {
                start = parseInt(start);
                offset = parseInt(offset)
                let bufferedActivities = await ctx.stub.getPrivateData("assetCollection", 'activity');

                let activities = JSON.parse(bufferedActivities.toString());

                let _logs = this.GetLogsByMSP(activities, MSP);

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

    async UpdatePrivateAsset(ctx, assetId, _tags) {
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), assetId);

            if (hash.length) {

                let bufferedAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), assetId)
                let asset = JSON.parse(bufferedAsset.toString());

                asset.tags = JSON.parse(_tags)

                await ctx.stub.putPrivateData(orgCollectionName.join(''), assetId, JSON.stringify(asset));

                await this.LogIt(ctx, `${assetId} has been updated successfully`, "SUCCESS UPDATE ASSET", [assetId]);

                return JSON.stringify({ message: 'Done', details: `Asset ${assetId} updated ` });

            } else return JSON.stringify({ message: 'Error', details: "Asset doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR UPDATE ASSET", [assetId]);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async RemovePrivateAsset(ctx, _assetIds) {
        try {

            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const assetIds = JSON.parse(_assetIds);

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');

            if (hash.length) {

                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                assets.forEach((asset, assetIndex) => {
                    assetIds.forEach((assetId) => {
                        if (assetId === asset) assets.splice(assetIndex, 1);
                    })
                })

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

                await this.LogIt(ctx, "Asset/s successfully deleted", "SUCCESS REMOVE ASSET", [...assetIds]);

                return JSON.stringify({ message: 'Done', details: "Asset/s successfully deleted" });

            } else return JSON.stringify({ message: 'Error', details: "Action not allowed" });

        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR REMOVE ASSET", [_assetIds]);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async CreatePrivateTransaction(ctx, ownerOrgId, newOwnerOrgId, transactionId, assetIds, newOwnerMSP) {

        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const _assetIds = JSON.parse(assetIds);

            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, 'transactions');

            let assetDetails = [];

            for (let _assetId of _assetIds) {
                let assetDetail = await this.ReadPrivateAsset(ctx, _assetId);
                let parsedAsset = JSON.parse(assetDetail);
                if (parsedAsset.message === "Done") {
                    assetDetails.push(parsedAsset.details);
                }
            }

            let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

            let assets = JSON.parse(bufferedAssets.toString());

            assets.forEach((asset, assetIndex) => {
                _assetIds.forEach((assetId) => {
                    if (assetId === asset) assets.splice(assetIndex, 1);
                })
            })

            await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

            await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify({ id: transactionId, assetIds: assetDetails, newOwnerMSP, isNewOwnerAccepted: false, isCurrentOwnerApproved: false, isCancelled: false, isReturned: false, cancelledAt: 0, returnedAt: 0, reasonForReturn: "", ownerOrgId, newOwnerOrgId, isOwnershipChanged: false }));

            if (hash.length) {

                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, 'transactions')

                let transactions = JSON.parse(bufferedTranscations.toString());

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }, ...transactions]))

            } else {

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }]))

            }

            await this.LogIt(ctx, `Initiated transfer of asset/s to ${newOwnerMSP}`, "INITIATE TRANSACTION", assetIds);

            return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} created` });
        } catch (error) {
            await this.LogIt(ctx, `Error creating transaction`, "ERROR INITIATE TRANSACTION", assetIds);
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

    // Yung owner ang nagcancel
    async CancelTransaction(ctx, transactionId) {
        let globalAssetIdsForCatch = [];

        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, transactionId);

            if (hash.length) {

                const bufferedTranscations = await ctx.stub.getPrivateData('assetCollection', transactionId);

                const transaction = JSON.parse(bufferedTranscations.toString());

                if (transaction.newOwnerMSP === MSP) return JSON.stringify({ message: 'Error', details: `You are not allowed to cancel this transaction` });

                const bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets');
                const assets = JSON.parse(bufferedAssets.toString());
                let toBackAssetIds = []

                for (let asset of transaction.assetIds) {
                    toBackAssetIds.push(asset.assetId)
                }

                globalAssetIdsForCatch = [...toBackAssetIds];

                transaction.isCancelled = true;
                transaction.cancelledAt = ctx.stub.getTxTimestamp().array[0]

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets, ...toBackAssetIds]));

                await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify(transaction));

                await this.LogIt(ctx, `Transaction ${transactionId} has been cancelled`, "CANCEL TRANSACTION", toBackAssetIds);

                return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} has been canceled` });

            } else return JSON.stringify({ message: 'Error', details: "Transaction doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, `Error cancelling transaction ${transactionId}: ${error.message}`, "ERROR CANCEL TRANSACTION", globalAssetIdsForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    // Ito is successful na ang transaction, then gusto ibalik
    async ReturnTransaction(ctx, transactionId, referTransactionId, newOwnerMSP, reason) {
        let globalAssetIdsForCatch = [];

        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, referTransactionId);

            if (hash.length) {

                const toBeReturnedBufferedTranscations = await ctx.stub.getPrivateData('assetCollection', referTransactionId);

                const toBeReturnedTransaction = JSON.parse(toBeReturnedBufferedTranscations.toString());

                let { ownerOrgId, newOwnerOrgId } = toBeReturnedTransaction;

                await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify({ id: transactionId, assetIds: toBeReturnedTransaction.assetIds, newOwnerMSP, isNewOwnerAccepted: false, isCurrentOwnerApproved: false, isCancelled: false, isReturned: true, cancelledAt: 0, returnedAt: ctx.stub.getTxTimestamp().array[0], reasonForReturn: reason, ownerOrgId, newOwnerOrgId }));

                let assetIds = [];

                for (let assetId of toBeReturnedTransaction.assetIds) {
                    assetIds.push(assetId.assetId)
                }

                globalAssetIdsForCatch = [...assetIds];

                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, 'transactions')

                let transactions = JSON.parse(bufferedTranscations.toString());

                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName, 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                assets.forEach((asset, assetIndex) => {
                    toBeReturnedTransaction.assetIds.forEach((transactionAsset) => {
                        if (transactionAsset.assetId === asset) assets.splice(assetIndex, 1);
                    })
                })

                await ctx.stub.putPrivateData(orgCollectionName, 'assets', JSON.stringify([...assets]));

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }, ...transactions]))

                await this.LogIt(ctx, `Transaction ${referTransactionId} initiate for return`, "RETURN TRANSACTION", assetIds);

                return JSON.stringify({ message: 'Done', details: "Returning assets" });

            } else return JSON.stringify({ message: 'Error', details: "Transaction doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, `Error returning transaction ${transactionId}: ${error.message}`, "ERROR RETURN TRANSACTION", globalAssetIdsForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async AcceptReturnTransaction(ctx, transactionId) {
        let globalAssetIdsForCatch = [];

        try {

            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, transactionId);

            if (hash.length) {

                let bufferedTranscation = await ctx.stub.getPrivateData(collectionName, transactionId)

                let transaction = JSON.parse(bufferedTranscation.toString());

                let assetIds = [];

                for (let asset of transaction.assetIds) {
                    assetIds.push(asset.assetId);
                }

                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName, 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                globalAssetIdsForCatch = [...assetIds];

                assets = [...assetIds, ...assets];

                await ctx.stub.putPrivateData(orgCollectionName, 'assets', JSON.stringify([...assets]));

                for (let asset of transaction.assetIds) {
                    await ctx.stub.putPrivateData(orgCollectionName, asset.asseId, JSON.stringify(asset));
                }

                await this.LogIt(ctx, `Assets has been accepted for return`, "SUCCESS RETURN ASSETS", assetIds);

                return JSON.stringify({ message: 'Done', details: "Returned assets has been accepted" });

            } else return JSON.stringify({ message: 'Error', details: "Transaction doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, `Error accepting returned assets ${transactionId}: ${error.message}`, "ERROR RETURN ASSETS", globalAssetIdsForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
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

        let globalAssetIdsForCatch = [];

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

                globalAssetIdsForCatch = [...assetIds];

                await this.LogIt(ctx, `${transaction.newOwnerMSP} accepted the transaction`, "ACCEPT TRANSACTION", assetIds);

                return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} accepted by ${MSP}` });
            } else {
                return JSON.stringify({ message: 'Error', details: 'You are not allowed to accept this transaction' });
            }

        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR ACCEPT TRANSACTION", globalAssetIdsForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }

    }

    async TransferNow(ctx, transactionId) {

        let globalAssetIdsForCatch = [];

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
                    let assetIds = []

                    for (let asset of transaction.assetIds) {
                        await ctx.stub.deletePrivateData([MSP, 'PrivateCollection'].join(''), asset.assetId);
                        assetIds.push(asset.assetId);
                    }

                    globalAssetIdsForCatch = [...assetIds];

                    await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assets]));

                    await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                    await this.LogIt(ctx, `Transaction ${transactionId} assets has been changed ownership`, "TRANSFERRED", assetIds);

                    return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} has been transferred` });
                } else {
                    return JSON.stringify({ message: 'Error', details: 'Cannot transfer: Receiver still not accepted the request' });
                }
            } else {
                return JSON.stringify({ message: 'Error', details: 'You are not allowed to process this transaction' })
            }
        } catch (error) {
            await this.LogIt(ctx, `Error while changing the ownership of assets in transaction ${transactionId} : ${error.message}`, "ERROR TRANSFERRING", globalAssetIdsForCatch);

            return JSON.stringify({ message: 'Error', details: error.message });
        }

    }

    async OwnAsset(ctx, transactionId) {
        let globalAssetIdsForCatch = [];

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

                    globalAssetIdsForCatch = [...assetIds];

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

                    transaction.isOwnershipChanged = true;

                    await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                    // await ctx.stub.deletePrivateData('assetCollection', transactionId);

                    // await this.DeleteTransaction(ctx, transactionId);

                    await this.LogIt(ctx, `Transaction ${transactionId} assets has been fully transferred to ${transaction.newOwnerMSP}`, "OWNED", assetIds);

                    return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} transferred successfully` });

                } else { return JSON.stringify({ message: 'Error', details: 'Owner still not approved the transfer' }); }
            } else { return JSON.stringify({ message: 'Error', details: 'You are not allowed to own this asset' }); }
        } catch (error) {
            await this.LogIt(ctx, `Error owning the asset in transaction ${transactionId} : ${error.message}`, "OWNED", globalAssetIdsForCatch);

            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }
}

module.exports = AssetTransfer;
