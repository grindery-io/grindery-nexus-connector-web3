import chai from "chai";
import chaiHttp from "chai-http";
import { onlyOnce } from "../../web3/evm/call";

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
});
