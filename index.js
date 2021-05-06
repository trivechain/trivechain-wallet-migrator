const fs = require('fs')
const axios = require('axios');
const axiosInstance = axios.create({
    timeout: 60000,
});
const { Transaction, PrivateKey, PublicKey, Address, Networks } = require('@trivechain/trivechaincore-lib');
const { ethers, BigNumber: EthersBigNumber } = require('ethers');
const BigNumber = require('bignumber.js');

const getUtxo = async (address) => {
    let result = { c: 1 };
    try {
        let utxos = [];
        let skip = 0;
        let loop = true;

        while (loop) {
            let tempUtxos;
            await axiosInstance.get(`https://api.trivechain.com/utxo/address/${address}?limit=500&skip=${skip}`)
                .then(res => tempUtxos = res)
                .catch(res => tempUtxos = res);

            if (!tempUtxos.status || tempUtxos.status !== 200) {
                console.error(tempUtxos);
            }

            tempUtxos = tempUtxos.data;

            utxos = utxos.concat(tempUtxos.utxos);

            if (tempUtxos.totalCount === utxos.length) {
                loop = false;
            } else {
                skip += 500;
            }
        }

        result = { c: 0, d: utxos };
        return result;
    } catch (err) {
        console.error(err);
    }
};


const main = async (walletfile, receivingAddress) => {
    let privateKeys = [];
    fs.readFileSync(walletfile, 'utf-8').split(/\r?\n/).forEach(function (line) {
        if (PrivateKey.isValid(line.substr(0, 52), Networks.livenet)) {
            privateKeys.push(line.substr(0, 52))
        }
    });

    if (privateKeys.length <= 0) {
        console.error("No privateKeys Found")
        return;
    }

    if (!Address.isValid(receivingAddress, Networks.livenet)) {
        console.error("Receiving Address not valid")
        return;
    }

    let addressesUtxoByBatch = { 0: [] };
    let batchNum = 0;

    // loop for all private keys
    for (let inputPrivateKey of privateKeys) {

        const privateKey = PrivateKey.fromWIF(inputPrivateKey);
        const publicKey = new PublicKey(privateKey)
        const fromAddress = new Address(publicKey, Networks.livenet).toString();

        let addressRes;
        await axiosInstance.get(`https://api.trivechain.com/address/balance/trvc/${fromAddress}`)
            .then(res => addressRes = res)
            .catch(err => addressRes = err);

        if (!addressRes || !addressRes.data || !('balanceSat' in addressRes.data)) {
            console.log(addressRes);
            console.log("From Address Error: ", fromAddress)
            continue;
        }

        if (EthersBigNumber.from(addressRes.data.balanceSat.toString()).lte(0)) {
            continue;
        }

        // get all utxos
        let utxoResp = await getUtxo(fromAddress);
        if (!utxoResp || utxoResp.c !== 0) {
            console.log("Unexpected Result from API")
        }

        utxoResp = utxoResp.d;

        if (utxoResp.length <= 0) {
            continue;
        }

        // collect the private key
        for (let u of utxoResp) {
            if (addressesUtxoByBatch[batchNum].length >= 300) {
                console.log("Found 300 UTXO for batch: ", batchNum)
                batchNum = batchNum + 1;
                addressesUtxoByBatch[batchNum] = [];
            }
            addressesUtxoByBatch[batchNum].push({ ...u, privateKey: privateKey })
        }
    }

    for (let j = 0; j <= batchNum; j++) {
        let assetUtxos = [], satoshiToSend = new BigNumber(0), utxos = [], build = false, privateKeyToSign = [];
        let addressesUtxo = addressesUtxoByBatch[j]
        console.log("Consolidating batchNum: ", j, " of ", batchNum)
        for (let i = addressesUtxo.length - 1; i >= 0; i--) {
            if (addressesUtxo[i].iscoinbase && !addressesUtxo[i].isConfirmed) continue;
            if (addressesUtxo[i].assets.length > 0) {
                assetUtxos.push(addressesUtxo[i]); // keep utxo with asset for later;
            } else {
                console.log(addressesUtxo[i].valueSat)
                if (addressesUtxo[i].valueSat != 5442) {
                    satoshiToSend = satoshiToSend.plus(new BigNumber(addressesUtxo[i].valueSat).minus(1000));
                    const utxo = new Transaction.UnspentOutput({
                        "txId": addressesUtxo[i].txid,
                        "outputIndex": addressesUtxo[i].index,
                        "address": addressesUtxo[i].scriptPubKey.addresses[0],
                        "script": addressesUtxo[i].scriptPubKey.hex,
                        "satoshis": addressesUtxo[i].valueSat
                    });
                    utxos.push(utxo);
                    if (privateKeyToSign.indexOf(addressesUtxo[i].privateKey) == -1) {
                        privateKeyToSign.push(addressesUtxo[i].privateKey);
                    }
                }
            }

            if (i === 0) build = true;

            if (!build) continue;
            if (utxos.length === 0) continue;

            satoshiToSend = satoshiToSend.integerValue().toNumber();
            console.log("Satoshi to send: ", satoshiToSend)
            console.log("Private Key to Sign: ", privateKeyToSign.length)
            console.log("Utxos Count: ", utxos.length)

            const fee = new BigNumber(utxos.length).multipliedBy(1000).integerValue().toNumber();

            console.log("Fee: ", fee)
            let transaction = new Transaction()
                .from(utxos)
                .fee(fee)
                .to(receivingAddress, satoshiToSend)

            for (let privKey of privateKeyToSign) {
                transaction = transaction.sign(privKey);
            }
            const hex = transaction.serialize();

            let broadcastResult;

            await axiosInstance.post(`https://api.trivechain.com/rpc/transmit`, { txHex: hex })
                .then(res => broadcastResult = res)
                .catch(res => broadcastResult = res);

            if (!broadcastResult.status || !broadcastResult.status === 200) {
                await sleep(2000)

                await axiosInstance.post(`https://api.trivechain.com/rpc/transmit`, { txHex: hex })
                    .then(res => broadcastResult = res)
                    .catch(res => broadcastResult = res);

                if (!broadcastResult.status || !broadcastResult.status === 200) {
                    console.log('copay utxo consolidation')
                    console.error(broadcastResult);
                }
            }
        }
    }
}

main('./filename.txt', 'receiving address');