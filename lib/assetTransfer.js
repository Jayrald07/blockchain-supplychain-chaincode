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

    async CreatePrivateAsset(ctx, asset) {
        try {
            const deserializedAsset = JSON.parse(asset);
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');

            if (hash.length) {
                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([deserializedAsset.id, ...assets]))
            } else {
                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([deserializedAsset.id]))
            }

            // await ctx.stub.putPrivateData(orgCollectionName.join(''), deserializedAsset.id, JSON.stringify(deserializedAsset))

            return `Asset ${deserializedAsset.id} created `;
        } catch (error) {
            return error.message;
        }
    }

    async CreatePrivateTransaction(ctx, transactionId, assetIds, newOwnerMSP) {

        try {
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, 'transactions');

            const MSP = ctx.clientIdentity.getMSPID()

            await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify({ id: transactionId, assetIds, newOwnerMSP, isNewOwnerAccepted: false, isCurrentOwnerApproved: false, status: 'CREATED', history: [MSP] }));

            if (hash.length) {
                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, newOwnerMSP)

                let transactions = JSON.parse(bufferedTranscations.toString());

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: Date.now() }, ...transactions]))
            } else {
                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: Date.now() }]))
            }

            return `Transaction ${transactionId} created`;
        } catch (error) {
            return error.message;
        }

    }

    async ReadPrivateAsset(ctx, assetId) {
        const orgCollectionName = [ctx.clientIdentity.getMSPID(), 'PrivateCollection'];
        try {
            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');
            if (hash.length) {
                const bufferedAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets');
                const assets = JSON.parse(bufferedAsset.toString());

                for (let asset of assets) {
                    if (asset.assetId === assetId) return JSON.stringify(asset);
                }

                return '';
            } else return `Asset ${assetId} cannot find`;
        } catch (error) {
            return error.message;
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
            return error.message;
        }
    }

    async ReadTransactionPrivateDetails(ctx, transactionId) {
        try {
            const bufferedTranscations = await ctx.stub.getPrivateData('assetCollection', transactionId);

            const transaction = JSON.parse(bufferedTranscations.toString());

            return JSON.stringify(transaction);
        } catch (error) {
            return error.message;
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

                return `Transaction ${transactionId} accepted by ${MSP}`;
            } else { return 'You are not allowed to accept this transaction'; }

        } catch (error) {
            return error.message;
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
                    let assets = JSON.parse(bufferedAssets);

                    assets.forEach((asset, assetIndex) => {
                        transaction.assetIds.forEach((transactionAsset) => {
                            if (transactionAsset === asset) assets.splice(assetIndex, 1);
                        })
                    })

                    transaction.isCurrentOwnerApproved = true;
                    transaction.status = 'FOR APPROVAL';

                    return 'Done';
                } else { return 'Cannot transfer: Receiver still not accepted the request'; }
            } else { return 'You are not allowed to process this transaction' }
        } catch (error) {
            return error.message;
        }

    }

    async OwnAsset(ctx, transactionId) {
        try {
            const MSP = ctx.clientIdentity.getMSPID();

            const bufferedTranscation = await ctx.stub.getPrivateData('assetCollection', transactionId);

            let transaction = JSON.parse(bufferedTranscation.toString());

            if (MSP === transaction.newOwnerMSP) {
                if (transaction.isCurrentOwnerApproved) {
                    await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify({ assetID }));

                    transaction.status = 'TRANSFERRED';

                    return `Transaction ${transactionId} transferred successfully`;
                } else { return 'Owner still not approved the transfer'; }
            } else { return 'You are not allowed to own this asset'; }
        } catch (error) {
            return error.message;
        }
    }
}

module.exports = AssetTransfer;
