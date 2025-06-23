declare module 'tronweb' {
  interface TronWebInstance {
    fullHost: string;
    headers?: Record<string, string>;
    privateKey?: string;
    
    isConnected(): Promise<boolean>;
    toSun(trx: number): number;
    fromSun(sun: number): number;
    isAddress(address: string): boolean;
    
    address: {
      fromHex(hex: string): string;
      toHex(base58: string): string;
    };
    
    trx: {
      getTransaction(txHash: string): Promise<any>;
      getTransactionInfo(txHash: string): Promise<any>;
      getNodeInfo(): Promise<any>;
      getBalance(address: string): Promise<number>;
      sendTransaction(to: string, amount: number): Promise<any>;
      getAccountResources(address: string): Promise<any>;
    };
    
    contract(): {
      at(address: string): Promise<any>;
    };
  }

  interface TronWebConstructor {
    new (options: {
      fullHost: string;
      headers?: Record<string, string>;
      privateKey?: string;
    }): TronWebInstance;
  }

  const TronWeb: TronWebConstructor;
  export = TronWeb;
}