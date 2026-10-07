export interface CalcResult {
  customerTotal: number;
  baseRate: number;
  rateWithIva: number;
  gatewayFee: number;
  installmentRate: number;
  financingCost: number;
  cpt: number;
  taxableBase: number;
  ivaDebit: number;
  ivaCreditProduct: number;
  ivaCreditGatewayFee: number;
  ivaCreditShipping: number;
  ivaNet: number;
  iibbWithholding: number;
  netReceived: number;
  productCostWithIva: number;
  shippingCost: number;
  realProfit: number;
  marginPercent: number;
}

export interface CalcInverseResult extends CalcResult {
  requiredSellingPrice: number;
}

export interface CalcBatchItem {
  productId: string;
  productName: string;
  cost: number;
  currentPrice: number | null;
  result: CalcResult | null;
}

export interface CalcError {
  error: true;
  message: string;
}
