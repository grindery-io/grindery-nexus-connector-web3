import chai from "chai";
import chaiHttp from "chai-http";
import { sanitizeParameters } from "../utils";
import { ConnectorInput } from "grindery-nexus-common-utils";
import sinon from "sinon";
import * as unitConverter from "../web3/evm/unitConverter";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);

const mockedConnectorInput: ConnectorInput<any> = {
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

sinon
  .stub(unitConverter, "convert")
  .callsFake(async function (
    _value: unknown,
    _spec: string,
    _fields: Record<string, unknown>,
    _parameters: Record<string, unknown>
  ) {
    return "1";
  });

describe("Utils test", async function () {
  describe("sanitizeParameters", async function () {
    it("Should not modify ConnectorInput  in the simplest case", async function () {
      chai.expect(await sanitizeParameters(mockedConnectorInput)).to.deep.equal(mockedConnectorInput);
    });

    it("Should transfer _grinderyContractAddress to contractAddress in fields", async function () {
      chai
        .expect(
          await sanitizeParameters({
            ...mockedConnectorInput,
            fields: {
              ...mockedConnectorInput.fields,
              _grinderyContractAddress: "0x388C818CA8B9251b393131C08a736A67ccB19297",
            },
          })
        )
        .to.deep.equal({
          ...mockedConnectorInput,
          fields: {
            ...mockedConnectorInput.fields,
            contractAddress: "0x388C818CA8B9251b393131C08a736A67ccB19297",
          },
        });
    });

    it("Should transfer _grinderyChain to chain in fields", async function () {
      chai
        .expect(
          await sanitizeParameters({
            ...mockedConnectorInput,
            fields: {
              ...mockedConnectorInput.fields,
              _grinderyChain: "eip155:250",
            },
          })
        )
        .to.deep.equal({
          ...mockedConnectorInput,
          fields: {
            ...mockedConnectorInput.fields,
            chain: "eip155:250",
          },
        });
    });

    it("Should set parameter as undefined if !!GRINDERY!!UNDEFINED!! in input", async function () {
      chai
        .expect(
          await sanitizeParameters({
            ...mockedConnectorInput,
            fields: {
              ...mockedConnectorInput.fields,
              parameters: { to: "0x388C818CA8B9251b393131C08a736A67ccB19297", value: "!!GRINDERY!!UNDEFINED!!" },
            },
          })
        )
        .to.deep.equal({
          ...mockedConnectorInput,
          fields: {
            ...mockedConnectorInput.fields,
            parameters: { to: "0x388C818CA8B9251b393131C08a736A67ccB19297", value: undefined },
          },
        });
    });

    it("Should set unit conversion properly in parameters", async function () {
      chai
        .expect(
          await sanitizeParameters({
            ...mockedConnectorInput,
            fields: {
              ...mockedConnectorInput.fields,
              parameters: {
                to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
                value: "1000",
                _grinderyUnitConversion_value: "erc20Decimals[@]",
              },
            },
          })
        )
        .to.deep.equal({
          ...mockedConnectorInput,
          fields: {
            ...mockedConnectorInput.fields,
            parameters: {
              to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
              value: "1",
              _grinderyUnitConversion_value: "erc20Decimals[@]",
            },
          },
        });
    });

    it("Should set unit conversion properly in parameterFilters", async function () {
      chai
        .expect(
          await sanitizeParameters({
            ...mockedConnectorInput,
            fields: {
              ...mockedConnectorInput.fields,
              parameterFilters: {
                to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
                value: "1000",
                _grinderyUnitConversion_value: "erc20Decimals[@]",
              },
            },
          })
        )
        .to.deep.equal({
          ...mockedConnectorInput,
          fields: {
            ...mockedConnectorInput.fields,
            parameterFilters: {
              to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
              value: "1",
              _grinderyUnitConversion_value: "erc20Decimals[@]",
            },
          },
        });
    });

    it("Should set unit conversion properly in fields is paramKeys array is empty", async function () {
      chai
        .expect(
          await sanitizeParameters(
            {
              ...mockedConnectorInput,
              fields: {
                ...mockedConnectorInput.fields,
                to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
                value: "1000",
                _grinderyUnitConversion_value: "erc20Decimals[@]",
              },
            },
            []
          )
        )
        .to.deep.equal({
          ...mockedConnectorInput,
          fields: {
            ...mockedConnectorInput.fields,
            to: "0x388C818CA8B9251b393131C08a736A67ccB19297",
            value: "1",
            _grinderyUnitConversion_value: "erc20Decimals[@]",
          },
        });
    });
  });
});
