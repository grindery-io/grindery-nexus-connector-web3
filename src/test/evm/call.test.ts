import chai from "chai";
import chaiHttp from "chai-http";
import { hubAvailability, isHubAvailable, onlyOnce } from "../../web3/evm/call";
import sinon from "sinon";
import Web3 from "web3";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);

describe("EVM call functions", function () {
  describe("onlyOnce", function () {
    it("Should execute the wrapped function only once", async function () {
      let counter = 0;
      const wrappedFn = onlyOnce(() => {
        counter++;
      });
      wrappedFn();
      wrappedFn();
      wrappedFn();
      chai.expect(counter).to.equal(1);
    });

    it("Should not execute the wrapped function if not called", async function () {
      let counter = 0;
      onlyOnce(() => {
        counter++;
      });
      chai.expect(counter).to.equal(0);
    });

    it("Should not modify the return value of wrapped function without explicit return", async function () {
      const wrappedFn = onlyOnce(() => {
        // Some implementation
      });
      const result = wrappedFn();
      chai.expect(result).to.be.undefined;
    });

    it("Should call the wrapped function and not modify its return value", async function () {
      let wasCalled = false;
      const expectedResult = "Hello, world!";
      const wrappedFn = onlyOnce(() => {
        wasCalled = true;
        return expectedResult;
      });

      wrappedFn();

      chai.expect(wasCalled).to.be.true;
    });
  });

  describe("isHubAvailable", function () {
    beforeEach(function () {
      hubAvailability.clear();
    });

    it("Should return true if hub is available on the chain", async function () {
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().resolves("0x123456"),
          },
        } as Web3)
      ).to.be.true;
    });

    it("Should return false if hub code is 0x", async function () {
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().resolves("0x"),
          },
        } as Web3)
      ).to.be.false;
    });

    it("Should return false if hub code is empty", async function () {
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().resolves(""),
          },
        } as Web3)
      ).to.be.false;
    });

    it("Should handle errors and return false if an error occurs", async function () {
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().rejects(new Error("Failed to get code")),
          },
        } as Web3)
      ).to.be.false;
    });

    it("Should cache and reuse hub availability information if same chain in two calls", async function () {
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().resolves("0x"),
          },
        } as Web3)
      ).to.be.false;
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().resolves("0x1324"),
          },
        } as Web3)
      ).to.be.false;
    });

    it("Should give new hub availability information if different chain in two calls", async function () {
      chai.expect(
        await isHubAvailable("mainnet", {
          eth: {
            getCode: sinon.stub().resolves("0x"),
          },
        } as Web3)
      ).to.be.false;
      chai.expect(
        await isHubAvailable("polygon", {
          eth: {
            getCode: sinon.stub().resolves("0x1324"),
          },
        } as Web3)
      ).to.be.true;
    });
  });
});
