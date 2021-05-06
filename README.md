# trivechain-wallet-migrator
This module is created for people that dump their wallet on trivechain core node
1. Download this project
2. run this `./trivechain-cli dumpprivkey "wallet.txt"` or go to tools > Debug console and run `dumpprivkey "wallet.txt"`
3. move "wallet.txt" to the project folder
4. Replace `main('./filename.txt', 'receiving address');` where filename is the filename you put or wallet.txt and receiving address is the receiving address.
5. Compile the project with `npm install`
6. run the index.js with `node index.js`
