import { ConnectorInput, ActionOutput, InputProviderInput, InputProviderOutput } from "grindery-nexus-common-utils";
import { FieldSchema } from "grindery-nexus-common-utils/dist/types";
import { callSmartContract } from "../../call";
import { sanitizeParameters } from "../../../../utils";
import { prepareOutput, CommonFields } from "./common";

type Fields = CommonFields & {
  _grinderyFunction?: string;
};
export async function genericAbiActionInputProvider(params: InputProviderInput<unknown>): Promise<InputProviderOutput> {
  const fieldData = params.fieldData as Fields;
  const { cds, ret } = await prepareOutput(fieldData);
  if (cds) {
    ret.inputFields.push({
      key: "_grinderyFunction",
      required: true,
      type: "string",
      label: "Function",
      choices: cds.actions.map((x) => ({
        value: x.operation.signature,
        sample: x.operation.signature,
        label: x.operation.signature,
      })),
    });
    if (fieldData?._grinderyFunction) {
      const action = cds.actions.find((x) => x.operation.signature === fieldData._grinderyFunction);
      if (action) {
        ret.inputFields = ret.inputFields.concat(
          action.operation.inputFields.map((x) => ({ ...x, updateFieldDefinition: false } as FieldSchema))
        );
        ret.outputFields = action.operation.outputFields;
      }
    }
  }
  return ret;
}

export async function genericAbiAction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as Fields;
  return await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        chain: fields._grinderyChain,
        contractAddress: fields._grinderyContractAddress,
        functionDeclaration: fields._grinderyFunction || "INVALID",
        parameters: fields,
      },
    })
  );
}
