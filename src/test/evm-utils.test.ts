import chai from "chai";
import chaiHttp from "chai-http";
import { isSameAddress } from "../web3/evm/utils";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);

describe("EVM utils tests", async function () {
  describe("isSameAddress (address A and address B)", async function () {
    it("Should return true if both two addresses are egal (case sensitive)", async function () {
      chai.expect(
        isSameAddress("0x71FA225B8F9Aeb50B44F96743275837F8EB7694E", "0x71FA225B8F9Aeb50B44F96743275837F8EB7694E")
      ).to.be.true;
    });

    it("Should return true if both two addresses are egal (case insensitive)", async function () {
      chai.expect(
        isSameAddress("0x71fa225B8F9Aeb50B44F96743275837F8EB7694E", "0x71FA225B8F9Aeb50B44F96743275837F8EB7694E")
      ).to.be.true;
    });

    it("Should return false if address A is null", async function () {
      chai.expect(isSameAddress(null, "0x71FA225B8F9Aeb50B44F96743275837F8EB7694E")).to.be.false;
    });

    it("Should return false if address B is null", async function () {
      chai.expect(isSameAddress("0x71FA225B8F9Aeb50B44F96743275837F8EB7694E", null)).to.be.false;
    });

    it("Should return false if address A and address B are null", async function () {
      chai.expect(isSameAddress(null, null)).to.be.false;
    });
  });
});
