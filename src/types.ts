export type RequestSchema = {
  method?: "GET" | "PUT" | "POST" | "PATCH" | "DELETE" | "HEAD";
  url: string;
  body?: null | string | object | unknown[];
  params?: { [key: string]: string };
  headers?: { [key: string]: string };
  auth?: string[] | object;
};
export type AuthCredentialsDisplayInfo = {
  id: string;
  name: string;
  createdAt: string;
};
export type MakeRequestResponse = {
  data: unknown;
  headers: { [key: string]: string };
};
export type Oauth2Config = {
  authorizeUrl: string;
  getAccessToken: RequestSchema;
  refreshAccessToken?: RequestSchema;
  codeParam?: string;
  scope?: string;
  autoRefresh?: string;
};

export type AuthenticationSchema = {
  test: RequestSchema;
  // fields: FieldsSchema[];
  label?: string | RequestSchema;
} & (
  | {
      type: "basic" | "custom" | "digest";
    }
  | {
      type: "oauth1";
      oauth1Config: {
        getRequestToken: RequestSchema;
        authorizeUrl: string;
        getAccessToken: RequestSchema;
      };
    }
  | {
      type: "oauth2";
      oauth2Config: Oauth2Config;
    }
  | {
      type: "session";
      sessionConfig: {
        operation: RequestSchema;
      };
    }
);
export type OperationSchema = {
  type: "trigger" | "action";
  connector: string; // the identifier of the connector app that defines this operation.
  operation: string; // the identifier of the connector app's trigger or action that defines this operation.
  input: { [key: string]: unknown }; // An object that defines the user's input as a `key`, `value` map where the `key` is the input field's identifier as defined in the corresponding [FieldSchema](../connectors/README.md#fieldschema) and the value is the user defined input value.
  display?: unknown; // An object that defines the user's input as a `key`, `label` map where the `key` is the input field's identifier as defined in the corresponding [FieldSchema](../connectors/README.md#fieldschema) and the label is the user friendly label that corresponds to the user's input value.
  authentication?: string; // the identifier of the connector app's authentication config.
  credentials?: { access_token: string }; // This will be used in prototype only
};
export type WorkflowSchema = {
  title: string;
  trigger: OperationSchema;
  actions: OperationSchema[];
  creator: string; // The DID of the creator of this workflow.
  signature: string; // signature of the workflow definition by the creator (i.e JSON of all fields except signature).
};
export type DisplaySchema = {
  label: string; // A short label for this trigger or action e.g "New Record" or "Create Record".
  description: string; // A short description for what this trigger or action does.
  instructions?: string; // Short instructions for how to use this trigger or action.
};
export type FieldChoiceSchema =
  | string
  | {
      value: string; // The actual value that is sent into the connector. Should match sample exactly.
      label: string; // A human readable label for this value.
      sample: string; // Displayed as light grey text in the editor. It's important that the value match the sample.
    };
export type FieldSchema = {
  key: string; // A unique machine readable key for this value (e.g "name").
  label?: string; // A human readable label for this value (e.g "Name").
  helpText?: string; // A human readable description of this value (e.g "Your full name.").
  type?: "string" | "text" | "integer" | "number" | "boolean" | "datetime" | "file" | "password" | "copy" | "code"; // The type of this value. Use `string` for basic text input, `text` for a large, `<textarea>` style box, and `code` for a `<textarea>` with a fixed-width (monospaced) font.
  required?: boolean; // If this value is required or not.
  placeholder?: string; // An example value that is not saved.
  default?: string; // A default value that is saved if no value is provided by the user.
  choices?: FieldChoiceSchema[]; // Defines the choices/options used to populate a dropdown.
  list?: boolean; // Defines whether a user can provide multiples on an input field or whether an output field returns an array of items of type `type`.
  children?: FieldSchema[]; // An array of child fields that define the structure of a sub-object for this field. Usually used for line items.
  dict?: boolean; // Is this field a key/value input?
  computed?: boolean; // Is this field automatically populated (and hidden from the user)?
  updateFieldDefinition?: boolean; // Only has effect when `inputFieldProviderUrl` is present. If not set or set to `true`, `inputFieldProviderUrl` is called to update field definition after this field is changed. If set to `false`, this field won't trigger field definition update.
  inputFormat?: string; // Useful when you expect the input to be part of a longer string. Put "{{input}}" in place of the user's input (e.g "https://{{input}}.yourdomain.com").
};
export type ChainEventOperationFilterSchema = {
  fromBlock?: number | string; // The number of the earliest block ("latest" may be given to mean the most recent and "pending" currently mining, block). By default "latest".
  toBlock?: number | string; // The number of the latest block ("latest" may be given to mean the most recent and "pending" currently mining, block). By default "latest".
  address?: string | string[]; // An address or a list of addresses to only get logs from particular account(s).
  topics?: string[]; // An array of values which must each appear in the log entries. The order is important, if you want to leave topics out use null, e.g. [null, '0x12...']. You can also pass an array for each topic with options for that topic e.g. [null, ['option1', 'option2']]
};
export type ChainEventOperationSchema = {
  type: "blockchain:event";
  chains: string[]; // All the chains for which this event is supported.
  signature: string; // Signature of the event e.g `Transfer(address,uint256)` for ERC20 Transfer event.
  filters: ChainEventOperationFilterSchema; // Defines the blockchain event filter parameters for this trigger.
  inputFields?: FieldSchema[]; // The data fields the user needs to configure for this trigger.
  inputFieldProviderUrl?: string; // A [JSON-RPC 2.0](https://www.jsonrpc.org/specification) endpoint for updating available input fields based on user input. If present, it is called after user changes a field (see `updateFieldDefinition` in [FieldSchema](#fieldschema) for details) to update available fields or choices. See also [FieldProviderRequestSchema](#fieldproviderrequestschema) and [FieldProviderResponseSchema](#fieldproviderresponseschema) for definition of the endpoint.
  outputFields?: FieldSchema[]; // The data fields returned by this trigger.
  sample: object; // Sample output data.
};
export type HookOperationSchema = {
  type: "hook"; // Must be set to `hook`.
  inputFields?: FieldSchema[]; // The data fields the user needs to configure for this trigger.
  inputFieldProviderUrl?: string; // A [JSON-RPC 2.0](https://www.jsonrpc.org/specification) endpoint for updating available input fields based on user input. If present, it is called after user changes a field (see `updateFieldDefinition` in [FieldSchema](#fieldschema) for details) to update available fields or choices. See also [FieldProviderRequestSchema](#fieldproviderrequestschema) and [FieldProviderResponseSchema](#fieldproviderresponseschema) for definition of the endpoint.
  outputFields?: FieldSchema[]; // The data fields returned by this trigger.
  sample: object; // Sample output data.
};
export type PollingOperationSchema = {
  type: "polling"; // Must be set to `polling`.
  operation: RequestSchema; // Defines how Nexus fetches data.
  inputFields?: FieldSchema[]; // The data fields the user needs to configure for this trigger.
  inputFieldProviderUrl?: string; // A [JSON-RPC 2.0](https://www.jsonrpc.org/specification) endpoint for updating available input fields based on user input. If present, it is called after user changes a field (see `updateFieldDefinition` in [FieldSchema](#fieldschema) for details) to update available fields or choices. See also [FieldProviderRequestSchema](#fieldproviderrequestschema) and [FieldProviderResponseSchema](#fieldproviderresponseschema) for definition of the endpoint.
  outputFields?: FieldSchema[]; // The data fields returned by this trigger.
  sample: object; // Sample output data.
};
export type TriggerSchema = {
  key: string; // A key to uniquely identify this trigger.
  name: string; // A short name to uniquely identify this trigger.
  display: DisplaySchema;
  operation: ChainEventOperationSchema | HookOperationSchema | PollingOperationSchema;
};
export type APICallOperationSchema = {
  type: "api"; // Must be set to `api`.
  operation: RequestSchema; // Defines how Nexus makes the API call.
  inputFields?: FieldSchema[]; // The data fields the user needs to configure for this trigger.
  inputFieldProviderUrl?: string; // A [JSON-RPC 2.0](https://www.jsonrpc.org/specification) endpoint for updating available input fields based on user input. If present, it is called after user changes a field (see `updateFieldDefinition` in [FieldSchema](#fieldschema) for details) to update available fields or choices. See also [FieldProviderRequestSchema](#fieldproviderrequestschema) and [FieldProviderResponseSchema](#fieldproviderresponseschema) for definition of the endpoint.
  outputFields?: FieldSchema[]; // The data fields returned by this trigger.
  sample: object; // Sample output data.
};
export type ChainCallOperationArgsSchema = {
  type: string; // The value type for this argument e.g `bool`, `int`, `uint`, `address` etc.
  value: number | string; // The value of the argument to be passed to the function.
};
export type ChainCallOperationSchema = {
  type: "blockchain:call"; // Must be set to `blockchain:call`.
  accounts: string[]; // The blockchain accounts for which this function can be called.
  signature: string; // Signature of the function e.g `transfer(address,uint256)` for ERC20 transfer call.
  arguments: ChainCallOperationArgsSchema[]; // Defines the blockchain function call arguments for this action.
  inputFields?: FieldSchema[]; // The data fields the user needs to configure for this trigger.
  inputFieldProviderUrl?: string; // A [JSON-RPC 2.0](https://www.jsonrpc.org/specification) endpoint for updating available input fields based on user input. If present, it is called after user changes a field (see `updateFieldDefinition` in [FieldSchema](#fieldschema) for details) to update available fields or choices. See also [FieldProviderRequestSchema](#fieldproviderrequestschema) and [FieldProviderResponseSchema](#fieldproviderresponseschema) for definition of the endpoint.
  outputFields?: FieldSchema[]; // The data fields returned by this trigger.
  sample: object; // Sample output data.
};
export type ActionSchema = {
  key: string; // A key to uniquely identify this action.
  name: string; // A short name to uniquely identify this action.
  display: DisplaySchema;
  operation: APICallOperationSchema | ChainCallOperationSchema;
};
export type ConnectorSchema = {
  name: string;
  version: string;
  platformVersion: string;
  triggers?: TriggerSchema[];
  actions?: ActionSchema[];
  authentication?: AuthenticationSchema;
};
