import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import * as web3 from "../../web3/evm/web3";
import { mockedTAccessToken } from "../utils";
import { droneAddressCache, getUserDroneAddress } from "../../web3/evm";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiHttp);
chai.use(chaiAsPromised);

describe("EVM index", function () {
  let contractStub: { methods: { getUserDroneAddress?: () => { call: () => Promise<string> } } };
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    contractStub = {
      methods: {
        getUserDroneAddress: () => ({ call: sandbox.stub().resolves("0xA1a547358A9Ca8E7b320d7742729e3334Ad96546") }),
      },
    };
    const getWeb3 = () => ({
      web3: {
        eth: {
          Contract: sandbox.stub().returns(contractStub),
        },
      },
      close: sandbox.stub(),
    });
    sandbox.stub(web3, "getWeb3").callsFake(getWeb3);
    droneAddressCache.clear();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("getUserDroneAddress", function () {
    it("Should return the proper user drone address", async function () {
      chai
        .expect(await getUserDroneAddress(mockedTAccessToken))
        .to.be.equal("0xA1a547358A9Ca8E7b320d7742729e3334Ad96546");
    });

    it("Should return cached drone address if present", async function () {
      await getUserDroneAddress(mockedTAccessToken);
      contractStub.methods.getUserDroneAddress = () => ({
        call: sandbox.stub().resolves("0x2149a5203ACb4ffE9b2E54A22A273Fb2E67e4C4c"),
      });
      chai
        .expect(await getUserDroneAddress(mockedTAccessToken))
        .to.be.equal("0xA1a547358A9Ca8E7b320d7742729e3334Ad96546");
    });

    it("Should handle missing getUserDroneAddress method", async function () {
      contractStub.methods.getUserDroneAddress = undefined;
      await chai
        .expect(getUserDroneAddress(mockedTAccessToken))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "(intermediate value).methods.getUserDroneAddress is not a function");
    });
  });
});
