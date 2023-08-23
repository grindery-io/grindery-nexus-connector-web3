import chai from "chai";
import chaiHttp from "chai-http";
import {
  decodeDroneCallResult,
  hubAvailability,
  isHubAvailable,
  onlyOnce,
  prepareRoutedTransaction,
} from "../../web3/evm/call";
import sinon from "sinon";
import Web3 from "web3";
import GrinderyNexusDrone from "../../web3/evm/abi/GrinderyNexusDrone.json";
import GrinderyNexusHub from "../../web3/evm/abi/GrinderyNexusHub.json";
import vaultSigner from "../../web3/evm/signer";
import { AbiItem } from "web3-utils";
import { HUB_ADDRESS } from "../../web3/evm/utils";
import chaiAsPromised from "chai-as-promised";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);
chai.use(chaiAsPromised);

describe("EVM call functions", function () {
  beforeEach(function () {
    hubAvailability.clear();
  });
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

  describe("decodeDroneCallResult", function () {
    it("Should properly decode parameters from call result", async function () {
      chai
        .expect(
          decodeDroneCallResult(
            "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000025455000000000000000000000000000000000000000000000000000000000000"
          )
        )
        .to.deep.equal({
          0: true,
          1: "0x5455",
          __length__: 2,
          success: true,
          returnData: "0x5455",
        });
    });

    it("Should return an error if call result is empty", async function () {
      chai
        .expect(() => decodeDroneCallResult(""))
        .to.throw(Error)
        .with.property(
          "message",
          "Returned values aren't valid, did it run Out of Gas? You might also see this error if you are not using the correct ABI for the contract you are retrieving data from, requesting data from a block number that does not exist, or querying a node which is not fully synced."
        );
    });

    it("Should return an error if hex data is invalid", async function () {
      chai
        .expect(() => decodeDroneCallResult("invalid"))
        .to.throw(Error)
        .with.property(
          "message",
          'invalid arrayify value (argument="value", value="0xinvalid", code=INVALID_ARGUMENT, version=bytes/5.7.0)'
        );
    });
  });

  describe("prepareRoutedTransaction", function () {
    let sandbox;
    let contractStub;
    let web3Stub;
    let nonce;

    beforeEach(function () {
      sandbox = sinon.createSandbox();

      contractStub = sandbox.stub();

      contractStub.withArgs(GrinderyNexusHub as AbiItem[], HUB_ADDRESS).returns({
        methods: {
          getUserDroneAddress: sandbox.stub().returns({
            call: sandbox.stub().resolves("0xabcdef1234567890abcdef1234567890abcdef12"),
          }),
          getTransactionHash: sandbox.stub().callsFake(function (_droneAddress, _to, nonc, _data) {
            nonce = nonc;
            return {
              call: sandbox.stub().resolves("0xfb2923f48dd233b905da8b05bd38d0d02f6f30794fe374d079dfa724b4263743"),
            };
          }),
          deployDroneAndSendTransaction: sandbox.stub().callsFake(function (userAddress, to, data, signature) {
            return {
              encodeABI: sandbox.stub().returns({ userAddress, to, data, signature }),
            };
          }),
        },
      });

      contractStub.withArgs(GrinderyNexusDrone as AbiItem[], sinon.match.string).returns({
        methods: {
          getNextNonce: sandbox.stub().returns({
            call: sandbox.stub().resolves(123),
          }),
          sendTransaction: sandbox.stub().callsFake(function (to, nonce, data, signature) {
            return {
              encodeABI: sandbox.stub().returns({ to, nonce, data, signature }),
            };
          }),
        },
      });

      web3Stub = {
        eth: {
          getCode: sandbox.stub().resolves("0x112233"),
          Contract: contractStub,
        },
        utils: {
          isAddress: sandbox.stub().resolves(true),
        },
      } as Web3;

      sandbox
        .stub(vaultSigner, "signMessage")
        .resolves(
          "0x2d0747a30877411db35e39e909a02c4a7b6af01469f12b4b28497c5da42aa4c3208f33238a95f44c33d37e710472e27ab89a3754541b99cf6703b8e50d8702ab1b"
        );
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("Should give tx result with droneContract sendTransaction if hasDrone", async function () {
      chai
        .expect(
          await prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: "0xabcdef",
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.deep.equal({
          tx: {
            to: "0xabcdef1234567890abcdef1234567890abcdef12",
            from: "0x1234567890abcdef1234567890abcdef12345678",
            data: {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              nonce: 123,
              data: "0xabcdef",
              signature:
                "0x2d0747a30877411db35e39e909a02c4a7b6af01469f12b4b28497c5da42aa4c3208f33238a95f44c33d37e710472e27ab89a3754541b99cf6703b8e50d8702ab1b",
            },
          },
          droneAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
        });
    });

    it("Should give tx result with hubContract deployDroneAndSendTransaction if drone code is 0x", async function () {
      web3Stub.eth.getCode = sandbox.stub().resolves("0x");
      hubAvailability.set("mainnet", true);
      chai
        .expect(
          await prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: "0xabcdef",
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.deep.equal({
          tx: {
            to: HUB_ADDRESS,
            from: "0x1234567890abcdef1234567890abcdef12345678",
            data: {
              userAddress: "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              data: "0xabcdef",
              signature:
                "0x2d0747a30877411db35e39e909a02c4a7b6af01469f12b4b28497c5da42aa4c3208f33238a95f44c33d37e710472e27ab89a3754541b99cf6703b8e50d8702ab1b",
            },
          },
          droneAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
        });
    });

    it("Should give tx result with hubContract deployDroneAndSendTransaction if drone code is empty", async function () {
      web3Stub.eth.getCode = sandbox.stub().resolves("");
      hubAvailability.set("mainnet", true);
      chai
        .expect(
          await prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: "0xabcdef",
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.deep.equal({
          tx: {
            to: HUB_ADDRESS,
            from: "0x1234567890abcdef1234567890abcdef12345678",
            data: {
              userAddress: "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              data: "0xabcdef",
              signature:
                "0x2d0747a30877411db35e39e909a02c4a7b6af01469f12b4b28497c5da42aa4c3208f33238a95f44c33d37e710472e27ab89a3754541b99cf6703b8e50d8702ab1b",
            },
          },
          droneAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
        });
    });

    it("Should return null drone address is hub not available", async function () {
      hubAvailability.set("mainnet", false);
      chai
        .expect(
          await prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: "0xabcdef",
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.deep.equal({
          tx: {
            to: "0xabcdef1234567890abcdef1234567890abcdef12",
            from: "0x1234567890abcdef1234567890abcdef12345678",
            data: "0xabcdef",
          },
          droneAddress: null,
        });
    });

    it("Should set nonce to 0 if drone code is 0x", async function () {
      web3Stub.eth.getCode = sandbox.stub().resolves("0x");
      hubAvailability.set("mainnet", true);

      await prepareRoutedTransaction(
        {
          to: "0xabcdef1234567890abcdef1234567890abcdef12",
          from: "0x1234567890abcdef1234567890abcdef12345678",
          data: "0xabcdef",
        },
        "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
        "mainnet",
        web3Stub
      );

      chai.expect(nonce).to.be.equal(0);
    });

    it("Should set nonce to 0 if drone code is empty", async function () {
      web3Stub.eth.getCode = sandbox.stub().resolves("");
      hubAvailability.set("mainnet", true);

      await prepareRoutedTransaction(
        {
          to: "0xabcdef1234567890abcdef1234567890abcdef12",
          from: "0x1234567890abcdef1234567890abcdef12345678",
          data: "0xabcdef",
        },
        "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
        "mainnet",
        web3Stub
      );

      chai.expect(nonce).to.be.equal(0);
    });

    it("Should throw an invalid tx error if to not present in proposed transaction", async function () {
      await chai
        .expect(
          prepareRoutedTransaction(
            {
              to: undefined,
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: "0xabcdef",
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid tx");

      chai.expect(nonce).to.be.equal(0);
    });

    it("Should throw an invalid tx error if from not present in proposed transaction", async function () {
      await chai
        .expect(
          prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: undefined,
              data: "0xabcdef",
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid tx");

      chai.expect(nonce).to.be.equal(0);
    });

    it("Should throw an invalid tx error if data not present in proposed transaction", async function () {
      await chai
        .expect(
          prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: undefined,
            },
            "0x4a6330220914727a2456a8A059F1ac5b5A1E5b6a",
            "mainnet",
            web3Stub
          )
        )
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid tx");

      chai.expect(nonce).to.be.equal(0);
    });

    it("Should throw an invalid user address error if user address is incorrect", async function () {
      await chai
        .expect(
          prepareRoutedTransaction(
            {
              to: "0xabcdef1234567890abcdef1234567890abcdef12",
              from: "0x1234567890abcdef1234567890abcdef12345678",
              data: "0xabcdef",
            },
            "invalid-address",
            "mainnet",
            web3Stub
          )
        )
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "userAddress is not an valid address");

      chai.expect(nonce).to.be.equal(0);
    });
  });
});
