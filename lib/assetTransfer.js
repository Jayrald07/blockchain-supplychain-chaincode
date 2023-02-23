'use strict';

const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class AssetTransfer extends Contract {

    async InitLedger(ctx) {
        const assets = [
            {
                name: "iPhones",
                ID: "123"
            }
        ];
        for (const asset of assets) {
            asset.docType = 'asset';
            await ctx.stub.putState(asset.ID, Buffer.from(stringify(sortKeysRecursive(asset))));
        }
    }

    async ReadAssetPrivateDetails(ctx, assetID) {
        const collectionName = [ctx.clientIdentity.getMSPID(), "PrivateCollection"]
        try {
            const asset = ctx.stub.getPrivateData(collectionName.join(""), assetID)
            return asset;
        } catch (error) {
            return JSON.stringify({ collectionName })
        }
    }

    async VerifyClientMatchesPeer(ctx) {
        const clientMSPID = ctx.clientIdentity.getMSPID();
        const peerMSPID = ctx.stub.getMspID();

        if (clientMSPID !== peerMSPID) {
            throw new Error(`Client from org ${clientMSPID} has no privilege to handle private data from org ${peerMSPID} peer`);
        }
    }

    async GetCollectionName(ctx) {
        return `${ctx.clientIdentity.getMSPID()}PrivateCollection`
    }

    async CreatePrivateData(ctx) {
        const transient = new Map(ctx.stub.getTransient());

        if (!transient.has("asset_properties")) throw new Error("Asset properties is required")
        console.log(transient);
        const { assetID, size, color } = JSON.parse(transient.get("asset_properties"))
        const asset = { assetID, size, color };

        const clientID = ctx.clientIdentity.getID()

        this.VerifyClientMatchesPeer(ctx);

        asset.owner = clientID;

        await ctx.stub.putPrivateData("assetCollection", assetID, JSON.stringify(asset));

        const orgCollectionName = [ctx.clientIdentity.getMSPID(), "PrivateCollection"];

        await ctx.stub.putPrivateData(orgCollectionName.join(""), assetID, JSON.stringify({ size }));

        return asset

    }

    // CreateAsset issues a new asset to the world state with given details.
    async CreateAsset(ctx, id, color, size, owner) {
        const exists = await this.AssetExists(ctx, id);
        if (exists) {
            throw new Error(`The asset ${id} already exists`);
        }

        const asset = {
            ID: id,
            Color: color,
            Size: size,
            Owner: owner,
        };
        //we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        const assetBuffer = Buffer.from(stringify(sortKeysRecursive(asset)))
        await ctx.stub.putState(id, assetBuffer);
        ctx.stub.setEvent('CreateAsset', assetBuffer);
        return JSON.stringify(asset);
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

    // DeleteAsset deletes an given asset from the world state.
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

    // TransferAsset updates the owner field of asset with given id in the world state.
    async TransferAsset(ctx, id, newOwner) {
        const assetString = await this.ReadAsset(ctx, id);
        const asset = JSON.parse(assetString);
        const oldOwner = asset.Owner;
        asset.Owner = newOwner;
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return oldOwner;
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
        for await (const keyMod of promiseOfIterator) {
            const resp = {
                timestamp: keyMod.timestamp,
                txid: keyMod.txId
            }
            if (keyMod.isDelete) resp.data = 'KEY DELETED';
            else resp.data = keyMod.value.toString('utf8');
            results.push(resp);
        }
        return JSON.stringify(results);
    }
}

module.exports = AssetTransfer;
