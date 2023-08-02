import { ConnectorInput } from "grindery-nexus-common-utils";
import { TAccessToken } from "../jwt";

export const mockedTAccessToken: TAccessToken = {
  aud: "urn:grindery:access-token:v1",
  sub: "eip155:1:0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E",
  iat: 1690548968,
  iss: "urn:grindery:orchestrator",
  exp: 1690552568,
};

export const mockedConnectorInput: ConnectorInput<any> = {
  sessionId: "mySessionId",
  cdsName: "myCdsName",
  key: "totalSupplyAction",
  fields: {
    chain: "eip155:5",
    contractAddress: "0xD6dAC59F68089CE0c82310Ec213Ac9E25561a5f0",
    parameters: {
      to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
      value: "1000",
    },
    functionDeclaration: "function transfer(address to, uint256 value) public virtual returns (bool) ",
    userToken:
      "eyJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHgxMEEyQzMwNmNDYzg3OTM4QjFmZTNjNjNEQmIxNDU3QTljODEwZGY1IiwiaWF0IjoxNjg3MjcwOTk1LCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjg3Mjc0NTk1fQ.WUEC1GFkRACK7rdwcV0kt08_m4-YDzifkWPWcdhsVzDAunevAnDD5mqILDX7Czn92eMUZy1hb3IFPJQyTzNQnw",
  },
};
