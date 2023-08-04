import { ConnectorInput } from "grindery-nexus-common-utils";
import { TAccessToken, signJWT } from "../jwt";

export const mockedTAccessToken: TAccessToken = {
  aud: "urn:grindery:access-token:v1",
  sub: "eip155:1:0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E",
  iat: 1690548968,
  iss: "urn:grindery:orchestrator",
  exp: 1690552568,
};

const createMockedConnectorInput = async () => {
  const mockedInput: ConnectorInput<any> = {
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
      userToken: await signJWT({ sub: "x" }, "60s"),
    },
  };

  return mockedInput;
};

export const mockedConnectorInput = createMockedConnectorInput();
