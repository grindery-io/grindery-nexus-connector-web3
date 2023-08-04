import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import axios from "axios";
import { sanitizeInput } from "../../../../web3/evm/connector/gnosisSafe";
import { mockedConnectorInput } from "../../../utils";
import chaiAsPromised from "chai-as-promised";
import { ConnectorInput } from "grindery-nexus-common-utils";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);
chai.use(chaiAsPromised);

sinon.stub(axios, "post").resolves(
  Promise.resolve({
    data: {
      chainId: "123",
      safe: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
    },
  })
);

let connectorInput: ConnectorInput<any>;

before(async () => {
  connectorInput = await mockedConnectorInput;
});

describe("Gnosis Safe index test", async function () {
  describe("sanitizeInput", async function () {
    it("Should update chain in input.fields if all parameters are properly set up", async function () {
      const mockedInput = {
        ...connectorInput,
        fields: {
          ...connectorInput.fields,
          contractAddress: "0xf7858Da8a6617f7C6d0fF2bcAFDb6D2eeDF64840",
          chainId: "234",
        },
      };
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        fields: {
          ...connectorInput.fields,
          contractAddress: "0xf7858Da8a6617f7C6d0fF2bcAFDb6D2eeDF64840",
          chainId: "234",
          chain: "eip155:234",
        },
      });
    });

    it("Should update chainId in input.fields via _grinderyChain in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: { ...connectorInput.fields, _grinderyChain: "eip155:234" },
      };
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          chainId: "234",
          chain: "eip155:234",
        },
      });
    });

    it("Should update chainId in input.fields via API call if _grinderyChain in input.fields is bad formatted", async function () {
      const mockedInput = {
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: { ...connectorInput.fields, _grinderyChain: "eip15:234" },
      };
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          contractAddress: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
          chainId: "123",
          chain: "eip155:123",
        },
      });
    });

    it("Should update contractAddress in input.fields via _grinderyContractAddress in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          chainId: "234",
          _grinderyContractAddress: "0x78e79E270eE8B43b15E22a23650Aba749272365B",
        },
      };
      delete mockedInput.fields.contractAddress;
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          chainId: "234",
          chain: "eip155:234",
          contractAddress: "0x78e79E270eE8B43b15E22a23650Aba749272365B",
        },
      });
    });

    it("Should throw an error if no authentication provided and contractAddress is not in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
        fields: { ...connectorInput.fields, chainId: "234" },
      };
      delete mockedInput.fields.contractAddress;
      await chai
        .expect(sanitizeInput(mockedInput))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Authentication required");
    });

    it("Should set contractAddress and chainId from API call if contractAddress is not in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: { ...connectorInput.fields, chainId: "234" },
      };
      delete mockedInput.fields.contractAddress;
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          contractAddress: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
          chain: "eip155:123",
          chainId: "123",
        },
      });
    });

    it("Should throw an error if no authentication provided and chainId is not in input.fields", async function () {
      await chai
        .expect(
          sanitizeInput({
            ...connectorInput,
          })
        )
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Authentication required");
    });

    it("Should set contractAddress and chainId from API call if chainId is not in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
      };
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          contractAddress: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
          chain: "eip155:123",
          chainId: "123",
        },
      });
    });

    it("Should throw an error if no authentication provided and chainId and contractAddress are not in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
      };
      delete mockedInput.fields.contractAddress;
      await chai
        .expect(sanitizeInput(mockedInput))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Authentication required");
    });

    it("Should set contractAddress and chainId from API call if chainId and contractAddress are not in input.fields", async function () {
      const mockedInput = {
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
      };
      delete mockedInput.fields.contractAddress;
      await sanitizeInput(mockedInput);
      chai.expect(mockedInput).to.deep.equal({
        ...connectorInput,
        authentication: connectorInput.fields.userToken,
        fields: {
          ...connectorInput.fields,
          contractAddress: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
          chain: "eip155:123",
          chainId: "123",
        },
      });
    });
  });
});
