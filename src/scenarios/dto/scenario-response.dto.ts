import { CalcResult } from '../../calculator/dto/calc-result.dto';

export interface ScenarioProductResult {
  productId: string;
  productName: string;
  productType: string;
  cost: number;
  realPrice: number | null;
  overridePrice: number | null;
  effectivePrice: number | null;
  simResult: CalcResult | null;
  realResult: CalcResult | null;
  isActive: boolean;
}

export interface ScenarioCalcResponse {
  scenarioId: string;
  scenarioName: string;
  gatewaySlug: string;
  planSlug: string | null;
  paymentMethod: string;
  withdrawalDays: number;
  installments: number;
  results: ScenarioProductResult[];
}
