import { ConnectorInput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { NewTransactionTrigger, NewEventTrigger } from "./triggers";

export { callSmartContract } from "./call";

export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", NewTransactionTrigger);
Triggers.set("newEvent", NewEventTrigger);
