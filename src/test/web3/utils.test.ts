import chai from "chai";
import chaiHttp from "chai-http";
import { getNetworkId } from "../../web3/utils";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiHttp);
chai.use(chaiAsPromised);

describe("Utils functions", function () {
  describe("getNetworkId", function () {
    it("Should return the proper network ID for eip155:43114", async function () {
      chai.expect(await getNetworkId("eip155:43114")).to.equal("43114");
    });

    it("Should return mainnet for algorand:mainnet", async function () {
      chai.expect(await getNetworkId("algorand:mainnet")).to.equal("mainnet");
    });

    it("Should return testnet for algorand:testnet", async function () {
      chai.expect(await getNetworkId("algorand:testnet")).to.equal("testnet");
    });

    it("Should return mainnet for near:mainnet", async function () {
      chai.expect(await getNetworkId("near:mainnet")).to.equal("mainnet");
    });

    it("Should return testnet for near:testnet", async function () {
      chai.expect(await getNetworkId("near:testnet")).to.equal("testnet");
    });

    it("Should return mainnet for flow:mainnet", async function () {
      chai.expect(await getNetworkId("flow:mainnet")).to.equal("mainnet");
    });

    it("Should return testnet for flow:testnet", async function () {
      chai.expect(await getNetworkId("flow:testnet")).to.equal("testnet");
    });

    it("Should throw an error for flow testnet format", async function () {
      await chai
        .expect(getNetworkId("flow testnet"))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid chain identifier format. Use 'network:chain' format.");
    });

    it("Should throw an error for flow.testnet format", async function () {
      await chai
        .expect(getNetworkId("flow.testnet"))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid chain identifier format. Use 'network:chain' format.");
    });

    it("Should throw an error for eip155.43114 format", async function () {
      await chai
        .expect(getNetworkId("eip155.43114"))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid chain identifier format. Use 'network:chain' format.");
    });

    it("Should throw an error for eip155 43114 format", async function () {
      await chai
        .expect(getNetworkId("eip155 43114"))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid chain identifier format. Use 'network:chain' format.");
    });
  });
});
