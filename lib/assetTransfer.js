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
        let iterator = await ctx.stub.getHistoryForKey(ID);
        let result = [];
        let res = await iterator.next();
        while (!res.done) {
            if (res.value) {
                console.info(`found state update with value: ${res.value.value.toString('utf8')}`);
                const obj = JSON.parse(res.value.value.toString('utf8'));
                result.push(obj);
            }
            res = await iterator.next();
        }

        await iterator.close();

        return JSON.stringify(result);
    }

    async LogIt(ctx, description, action, assets) {
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash('assetCollection', 'activity');

            if (hash.length) {

                let bufferedActivities = await ctx.stub.getPrivateData("assetCollection", 'activity');

                let activities = JSON.parse(bufferedActivities.toString());

                let activity = { initiated: MSP, description, assets, action, timestamp: ctx.stub.getTxTimestamp().array[0] };

                await ctx.stub.putPrivateData("assetCollection", 'activity', JSON.stringify([activity, ...activities]))

            } else {

                let activity = { initiated: MSP, description, assets, action, timestamp: ctx.stub.getTxTimestamp().array[0] };

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

    async CreatePrivateAsset(ctx, orgId, assetId, tags, subAssetIds) {
        let globalAssetForCatch = []
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');
            const _tags = JSON.parse(tags);
            const _subAssetIds = JSON.parse(subAssetIds);

            let subAssetDetails = [];

            if (hash.length) {

                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([assetId, ...assets]))

                for (let subAssetId of _subAssetIds) {

                    let bufferedAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), subAssetId)

                    let asset = JSON.parse(bufferedAsset.toString());

                    subAssetDetails.push(asset);

                }

            } else {

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([assetId]))

            }


            let data = {
                assetId,
                tags: _tags,
                subAssets: subAssetDetails,
                history: [{
                    org: orgId,
                    timestamp: ctx.stub.getTxTimestamp().array[0]
                }]
            }

            await ctx.stub.putPrivateData(orgCollectionName.join(''), assetId, JSON.stringify(data))

            // await ctx.stub.putState(assetId, Buffer.from(stringify(sortKeysRecursive(data))));

            globalAssetForCatch = [data]

            await this.LogIt(ctx, "New asset created", "CREATE ASSET", [data]);

            return JSON.stringify({ message: 'Done', details: `Asset ${assetId} created ` });
        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR CREATE ASSET", globalAssetForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async PushAssets(ctx, assets) {
        let globalAssetForCatch = []
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');
            const _assets = JSON.parse(assets);

            globalAssetForCatch = _assets;

            if (hash.length) {
                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                for (let asset of _assets) {
                    if (!assets.includes(asset.assetId)) assets.push(asset.assetId);
                }

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]))
            } else {
                let assetsNew = [];

                for (let asset of _assets) {
                    assetsNew.push(asset.assetId);
                }

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assetsNew]))
            }

            for (let asset of _assets) {

                await ctx.stub.putPrivateData(orgCollectionName.join(''), asset.assetId, JSON.stringify({
                    assetId: asset.assetId,
                    subAssets: asset.subAssets,
                    tags: asset.tags,
                    history: asset.history
                }))

            }

            await this.LogIt(ctx, "New asset pushed", "PUSH ASSET", [..._assets]);

            return JSON.stringify({ message: 'Done', details: `Asset/s pushed` });
        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR PUSH ASSET", globalAssetForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async PullAssets(ctx, assetIds) {
        let globalAssetForCatch = [];
        try {

            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');

            const _assetIds = JSON.parse(assetIds);

            if (hash.length) {

                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                let assetDetails = []

                assets = assets.filter(assetId => !_assetIds.includes(assetId))

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

                for (let assetId of _assetIds) {

                    let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), assetId)

                    let asset = JSON.parse(bufferedAssets.toString());

                    assetDetails.push(asset);

                }

                globalAssetForCatch = assetDetails;

                for (let assetId of _assetIds) {

                    await ctx.stub.deletePrivateData(orgCollectionName.join(''), assetId)

                }

                await this.LogIt(ctx, `Asset/s has been moved`, "MOVE ASSET", assetDetails);


                return JSON.stringify({ message: "Done", details: assetDetails });

            } else return JSON.stringify({ message: 'Error', details: "No assets" });

        } catch (error) {
            await this.LogIt(ctx, `Error asset/s moving`, "ERROR MOVE ASSET", globalAssetForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async UpdatePrivateAsset(ctx, assetId, _tags, subAssetIds) {
        let globalAssetForCatch = [];
        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const _subAssetIds = JSON.parse(subAssetIds);

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), assetId);

            if (hash.length) {

                let bufferedAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), assetId)
                let asset = JSON.parse(bufferedAsset.toString());

                asset.tags = JSON.parse(_tags)

                let subAssetDetails = [];

                for (let subAssetId of _subAssetIds) {

                    let bufferedSubAsset = await ctx.stub.getPrivateData(orgCollectionName.join(''), subAssetId)

                    let subAsset = JSON.parse(bufferedSubAsset.toString());

                    subAssetDetails.push(subAsset);

                }

                asset.subAssets = subAssetDetails;

                await ctx.stub.putPrivateData(orgCollectionName.join(''), assetId, JSON.stringify(asset));

                // await ctx.stub.putState(assetId, Buffer.from(stringify(sortKeysRecursive(asset))));

                globalAssetForCatch = [asset];

                await this.LogIt(ctx, `${assetId} has been updated successfully`, "SUCCESS UPDATE ASSET", [asset]);

                return JSON.stringify({ message: 'Done', details: `Asset ${assetId} updated ` });

            } else return JSON.stringify({ message: 'Error', details: "Asset doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR UPDATE ASSET", globalAssetForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async RemovePrivateAsset(ctx, _assetIds) {
        let globalAssetForCatch = []
        try {

            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const assetIds = JSON.parse(_assetIds);

            const hash = await ctx.stub.getPrivateDataHash(orgCollectionName.join(''), 'assets');

            if (hash.length) {

                let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                let assets = JSON.parse(bufferedAssets.toString());

                assets = assets.filter(assetId => !assetIds.includes(assetId))

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

                let assetDetails = [];

                for (let assetId of assetIds) {
                    let bufferedAssetDetails = await ctx.stub.getPrivateData(orgCollectionName.join(''), assetId)

                    let asset = JSON.parse(bufferedAssetDetails.toString());

                    assetDetails.push(asset)

                }

                globalAssetForCatch = assetDetails;


                await this.LogIt(ctx, "Asset/s successfully deleted", "SUCCESS REMOVE ASSET", assetDetails);

                return JSON.stringify({ message: 'Done', details: "Asset/s successfully deleted" });

            } else return JSON.stringify({ message: 'Error', details: "Action not allowed" });

        } catch (error) {
            await this.LogIt(ctx, error.message, "ERROR REMOVE ASSET", globalAssetForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async CreatePrivateTransaction(ctx, ownerOrgId, newOwnerOrgId, transactionId, assetIds, newOwnerMSP) {
        let globalAssetForCatch = []
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

            assets = assets.filter(assetId => !_assetIds.includes(assetId))

            await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

            await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify({ id: transactionId, assetIds: assetDetails, newOwnerMSP, isNewOwnerAccepted: false, isCurrentOwnerApproved: false, isCancelled: false, isReturned: false, isRejected: false, isGotBack: false, cancelledAt: 0, rejectedAt: 0, returnedAt: 0, ownerOrgId, newOwnerOrgId, isOwnershipChanged: false, created: ctx.stub.getTxTimestamp().array[0] }));

            if (hash.length) {

                let bufferedTranscations = await ctx.stub.getPrivateData(collectionName, 'transactions')

                let transactions = JSON.parse(bufferedTranscations.toString());

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }, ...transactions]))

            } else {

                await ctx.stub.putPrivateData(collectionName, 'transactions', JSON.stringify([{ id: transactionId, created: ctx.stub.getTxTimestamp().array[0] }]))

            }

            globalAssetForCatch = assetDetails

            await this.LogIt(ctx, `Initiated transfer of asset/s to ${newOwnerMSP}`, "INITIATE TRANSACTION", assetDetails);

            return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} created` });
        } catch (error) {
            await this.LogIt(ctx, `Error creating transaction`, "ERROR INITIATE TRANSACTION", globalAssetForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }

    }
    // reject
    async RejectTransaction(ctx, transactionId, reason) {
        let globalAssetIdsForCatch = [];

        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, transactionId);

            if (hash.length) {

                const bufferedTranscations = await ctx.stub.getPrivateData('assetCollection', transactionId);

                const transaction = JSON.parse(bufferedTranscations.toString());

                if (transaction.newOwnerMSP !== MSP) return JSON.stringify({ message: 'Error', details: `You are not allowed to reject this transaction` });

                let toBackAsset = []

                for (let asset of transaction.assetIds) {
                    toBackAsset.push(asset)
                }

                globalAssetIdsForCatch = [...toBackAsset];

                transaction.reason = reason
                transaction.isRejected = true;
                transaction.rejectedAt = ctx.stub.getTxTimestamp().array[0]

                const hashDump = await ctx.stub.getPrivateDataHash(collectionName, transaction.ownerOrgId);

                if (hashDump.length) {

                    const buffedTrans = await ctx.stub.getPrivateData(collectionName, transaction.ownerOrgId);

                    const trans = JSON.parse(buffedTrans.toString());

                    await ctx.stub.putPrivateData(collectionName, transaction.ownerOrgId, JSON.stringify([...toBackAsset, ...trans]));

                } else {
                    await ctx.stub.putPrivateData(collectionName, transaction.ownerOrgId, JSON.stringify([...toBackAsset]));
                }

                await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify(transaction));

                await this.LogIt(ctx, `Transaction ${transactionId} has been rejected`, "REJECT TRANSACTION", globalAssetIdsForCatch);

                return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} has been rejected` });

            } else return JSON.stringify({ message: 'Error', details: "Transaction doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, `Error rejecting transaction ${transactionId}: ${error.message}`, "ERROR REJECT TRANSACTION", globalAssetIdsForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async GetBackAssets(ctx, transactionId) {
        let globalAssetIdsForCatch = [];

        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, transactionId);

            if (hash.length) {

                const bufferedTranscation = await ctx.stub.getPrivateData(collectionName, transactionId);

                const transaction = JSON.parse(bufferedTranscation.toString());

                let assetIds = []

                const hashDump = await ctx.stub.getPrivateDataHash(collectionName, transaction.ownerOrgId);

                if (hashDump.length) {

                    const buffedTrans = await ctx.stub.getPrivateData(collectionName, transaction.ownerOrgId);

                    let assetsBack = JSON.parse(buffedTrans.toString());

                    assetIds = assetsBack.map(asset => asset.assetId)

                    const bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets');
                    const assets = JSON.parse(bufferedAssets.toString());

                    transaction.isGotBack = true;

                    await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets, ...assetIds]));

                    await ctx.stub.deletePrivateData(collectionName, transaction.ownerOrgId);

                    for (let asset of assetsBack) {

                        await ctx.stub.putPrivateData(orgCollectionName.join(""), asset.assetId, JSON.stringify(asset));

                    }

                    globalAssetIdsForCatch = assetsBack;

                    await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify(transaction));

                    await this.LogIt(ctx, `Success getting back assets`, "GET BACK ASSETS", assetsBack);

                    return JSON.stringify({ message: 'Done', details: "Assets successfully got back" });

                } else JSON.stringify({ message: 'Error', details: "Nothing to get" });


            } else return JSON.stringify({ message: 'Error', details: "Transaction doesn't exist" });


        } catch (error) {
            await this.LogIt(ctx, `Error getting back assets`, "ERROR GET BACK ASSETS", globalAssetIdsForCatch);
            return JSON.stringify({ message: 'Error', details: error.message });
        }
    }

    async ReturnTransaction(ctx, transactionId, reason) {
        let globalAssetIdsForCatch = [];

        try {
            const MSP = ctx.clientIdentity.getMSPID();
            const orgCollectionName = [MSP, 'PrivateCollection'];
            const collectionName = "assetCollection";

            const hash = await ctx.stub.getPrivateDataHash(collectionName, transactionId);

            if (hash.length) {

                const bufferedTranscations = await ctx.stub.getPrivateData('assetCollection', transactionId);

                const transaction = JSON.parse(bufferedTranscations.toString());

                if (transaction.newOwnerMSP !== MSP) return JSON.stringify({ message: 'Error', details: `You are not allowed to return this transaction` });

                let toBackAsset = []

                for (let asset of transaction.assetIds) {
                    toBackAsset.push(asset)
                }

                globalAssetIdsForCatch = [...toBackAsset];

                const hashDump = await ctx.stub.getPrivateDataHash(collectionName, transaction.ownerOrgId);

                if (hashDump.length) {

                    const buffedTrans = await ctx.stub.getPrivateData(collectionName, transaction.ownerOrgId);

                    const trans = JSON.parse(buffedTrans.toString());

                    await ctx.stub.putPrivateData(collectionName, transaction.ownerOrgId, JSON.stringify([...toBackAsset, ...trans]));

                    let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                    let assets = JSON.parse(bufferedAssets.toString());

                    let assetIds = toBackAsset.map(item => item.assetId);

                    assets = assets.filter(assetId => !assetIds.includes(assetId))

                    await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

                    for (let assetId of assetIds) {
                        await ctx.stub.deletePrivateData(orgCollectionName.join(""), assetId);
                    }


                } else {

                    await ctx.stub.putPrivateData(collectionName, transaction.ownerOrgId, JSON.stringify([...toBackAsset]));

                    let bufferedAssets = await ctx.stub.getPrivateData(orgCollectionName.join(''), 'assets')

                    let assets = JSON.parse(bufferedAssets.toString());

                    let assetIds = toBackAsset.map(item => item.assetId);

                    assets = assets.filter(assetId => !assetIds.includes(assetId))

                    await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets]));

                    for (let assetId of assetIds) {
                        await ctx.stub.deletePrivateData(orgCollectionName.join(""), assetId);
                    }

                }

                transaction.isReturned = true;
                transaction.returnedAt = ctx.stub.getTxTimestamp().array[0]
                transaction.reason = reason

                await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify(transaction));

                await this.LogIt(ctx, `Transaction ${transactionId} has been returned`, "RETURN TRANSACTION", toBackAsset);

                return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} has been returned` });

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
                let assetDetails = [];

                for (let asset of transaction.assetIds) {
                    toBackAssetIds.push(asset.assetId)
                    assetDetails.push(asset);
                }

                globalAssetIdsForCatch = [...assetDetails];

                transaction.isCancelled = true;
                transaction.cancelledAt = ctx.stub.getTxTimestamp().array[0]

                await ctx.stub.putPrivateData(orgCollectionName.join(''), 'assets', JSON.stringify([...assets, ...toBackAssetIds]));

                await ctx.stub.putPrivateData(collectionName, transactionId, JSON.stringify(transaction));

                await this.LogIt(ctx, `Transaction ${transactionId} has been cancelled`, "CANCEL TRANSACTION", assetDetails);

                return JSON.stringify({ message: 'Done', details: `Transaction ${transactionId} has been canceled` });

            } else return JSON.stringify({ message: 'Error', details: "Transaction doesn't exist" });

        } catch (error) {
            await this.LogIt(ctx, `Error cancelling transaction ${transactionId}: ${error.message}`, "ERROR CANCEL TRANSACTION", globalAssetIdsForCatch);
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
                let assetDetails = []

                for (let asset of transaction.assetIds) {
                    assetIds.push(asset.assetId);
                    assetDetails.push(asset);
                }

                globalAssetIdsForCatch = [...assetDetails];

                await this.LogIt(ctx, `${transaction.newOwnerMSP} accepted the transaction`, "ACCEPT TRANSACTION", assetDetails);

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

                    let _assetIds = transaction.assetIds.map(asset => asset.assetId);

                    assets = assets.filter(item => !_assetIds.includes(item))

                    transaction.isCurrentOwnerApproved = true;
                    let assetIds = []
                    let assetDetails = [];

                    for (let asset of transaction.assetIds) {
                        await ctx.stub.deletePrivateData([MSP, 'PrivateCollection'].join(''), asset.assetId);
                        assetIds.push(asset.assetId);
                        assetDetails.push(asset);
                    }

                    globalAssetIdsForCatch = [...assetDetails];

                    await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assets]));

                    await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                    await this.LogIt(ctx, `Transaction ${transactionId} assets has been changed ownership`, "TRANSFERRED", assetDetails);

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
                    let assetDetails = [];

                    for (let asset of transaction.assetIds) {
                        assetIds.push(asset.assetId)
                        assetDetails.push(asset);
                    }

                    globalAssetIdsForCatch = [...assetDetails];

                    if (hash.length) {
                        let bufferedAssets = await ctx.stub.getPrivateData([MSP, 'PrivateCollection'].join(''), 'assets');

                        let assets = JSON.parse(bufferedAssets.toString());

                        await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assetIds, ...assets]));

                    } else {
                        await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), 'assets', JSON.stringify([...assetIds]));
                    }

                    for (let asset of transaction.assetIds) {
                        let _history = [{ org: transaction.newOwnerOrgId, timestamp: ctx.stub.getTxTimestamp().array[0] }, ...asset.history]
                        asset.history = _history;
                        await ctx.stub.putPrivateData([MSP, 'PrivateCollection'].join(''), asset.assetId, JSON.stringify(asset));
                    }

                    transaction.isOwnershipChanged = true;

                    await ctx.stub.putPrivateData('assetCollection', transactionId, JSON.stringify(transaction));

                    // await ctx.stub.deletePrivateData('assetCollection', transactionId);

                    // await this.DeleteTransaction(ctx, transactionId);

                    await this.LogIt(ctx, `Transaction ${transactionId} assets has been fully transferred to ${transaction.newOwnerMSP}`, "OWNED", assetDetails);

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
