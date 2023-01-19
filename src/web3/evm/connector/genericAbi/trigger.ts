import { ConnectorInput, InputProviderInput, InputProviderOutput, TriggerBase } from "grindery-nexus-common-utils";
import { FieldSchema } from "grindery-nexus-common-utils/dist/types";
import { NewEventTrigger } from "../../triggers";
import { sanitizeParameters } from "../../../../utils";
import { prepareOutput, CommonFields } from "./common";

type Fields = CommonFields & {
  _grinderyEvent?: string;
};
export async function genericAbiTriggerInputProvider(
  params: InputProviderInput<unknown>
): Promise<InputProviderOutput> {
  const fieldData = params.fieldData as Fields;
  const { cds, ret } = await prepareOutput(fieldData);
  if (cds) {
    ret.inputFields.push({
      key: "_grinderyEvent",
      required: true,
      type: "string",
      label: "Smart Contract Event",
      choices: cds.triggers.map((x) => ({
        value: x.operation.signature,
        sample: x.operation.signature,
        label: x.operation.signature,
      })),
      helpText:
        "Select the smart contract event you want to use as a trigger. Next you will be able to set the parameters.",
    });
    if (fieldData?._grinderyEvent) {
      const trigger = cds.triggers.find((x) => x.operation.signature === fieldData._grinderyEvent);
      if (trigger) {
        ret.inputFields = ret.inputFields.concat(
          trigger.operation.inputFields.map((x) => ({ ...x, updateFieldDefinition: false } as FieldSchema))
        );
        ret.outputFields = trigger.operation.outputFields;
      }
    }
  }
  return ret;
}

export async function genericAbiTrigger(input: ConnectorInput<unknown>): Promise<TriggerBase> {
  const fields = input.fields as Fields;
  return new NewEventTrigger(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        chain: fields._grinderyChain,
        contractAddress: fields._grinderyContractAddress,
        eventDeclaration: fields._grinderyEvent || "INVALID",
        parameterFilters: fields,
      },
    })
  );
}
