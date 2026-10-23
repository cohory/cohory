import type { CustomerRecord, SubscriptionRecord } from "../repository";

export interface ErasureStore {
  listCustomers(userId: string): Promise<CustomerRecord[]>;
  listOpenSubscriptions(userId: string): Promise<SubscriptionRecord[]>;
  forgetEmail(userId: string): Promise<{ moves: number; links: number }>;
}
