import chai from "chai";
import { UNIT_CONVERTERS, numberToString, scaleDecimals } from "../web3/evm/unitConverter";
import sinon from "sinon";
import * as web3 from "../web3/evm/web3";

describe("Unit Converter", async function () {
  let contractStub: { methods: { decimals: object } };
  let getWeb3: object;
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    contractStub = {
      methods: {
        decimals: sandbox.stub().resolves("18"),
      },
    };
    getWeb3 = () => {
      const web3Stub = {
        eth: {
          Contract: sandbox.stub().returns(contractStub),
        },
      };
      const closeStub = sandbox.stub();
      return {
        web3: web3Stub,
        close: closeStub,
      };
    };
    sandbox.stub(web3, "getWeb3").callsFake(getWeb3);
    contractStub.methods.decimals = sandbox.stub().returns({
      call: sandbox.stub().resolves("18"),
    });
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("numberToString", async function () {
    it("Should convert a valid string number to string", async function () {
      chai.expect(numberToString("42")).to.equal("42");
      chai.expect(numberToString("8.15")).to.equal("8.15");
      chai.expect(numberToString("-50")).to.equal("-50");
      chai.expect(numberToString("-3.14")).to.equal("-3.14");
      chai.expect(numberToString("0")).to.equal("0");
    });

    it("Should throw an error if string is invalid", async function () {
      chai
        .expect(() => numberToString("/42"))
        .to.throw(Error)
        .with.property(
          "message",
          "while converting number to string, invalid number value '/42', should be a number matching (^-?[0-9.]+)."
        );
      chai
        .expect(() => numberToString("&42"))
        .to.throw(Error)
        .with.property(
          "message",
          "while converting number to string, invalid number value '&42', should be a number matching (^-?[0-9.]+)."
        );
      chai
        .expect(() => numberToString(" 42"))
        .to.throw(Error)
        .with.property(
          "message",
          "while converting number to string, invalid number value ' 42', should be a number matching (^-?[0-9.]+)."
        );
    });

    it("Should convert a number to string", async function () {
      chai.expect(numberToString(42)).to.equal("42");
      chai.expect(numberToString(8.15)).to.equal("8.15");
      chai.expect(numberToString(-50)).to.equal("-50");
      chai.expect(numberToString(-3.14)).to.equal("-3.14");
      chai.expect(numberToString(0)).to.equal("0");
    });

    it("Should convert an object with toString method to string", async () => {
      let customValue = "42";
      const objWithToString = {
        toString: () => customValue.toString(),
        toTwos: () => "",
        dividedToIntegerBy: () => "",
      };
      chai.expect(numberToString(objWithToString)).to.equal("42");
      customValue = "8.15";
      chai.expect(numberToString(objWithToString)).to.equal("8.15");
      customValue = "-50";
      chai.expect(numberToString(objWithToString)).to.equal("-50");
      customValue = "-3.14";
      chai.expect(numberToString(objWithToString)).to.equal("-3.14");
      customValue = "0";
      chai.expect(numberToString(objWithToString)).to.equal("0");
    });

    it("Should throw an error for invalid inputs", async () => {
      chai
        .expect(() => numberToString("invalid"))
        .to.throw(Error)
        .with.property(
          "message",
          "while converting number to string, invalid number value 'invalid', should be a number matching (^-?[0-9.]+)."
        );
      chai
        .expect(() => numberToString({}))
        .to.throw(Error)
        .with.property(
          "message",
          "while converting number to string, invalid number value '[object Object]' type object."
        );
      chai
        .expect(() => numberToString([]))
        .to.throw(Error)
        .with.property("message", "while converting number to string, invalid number value '' type object.");
    });
  });

  describe("scaleDecimals", async function () {
    it("Should correctly integer decimals", async () => {
      const decimals = 18;
      const weiValue = scaleDecimals("50", decimals);
      chai.expect(weiValue).to.equal("50000000000000000000");
    });

    it("Should correctly scale decimals", async () => {
      const decimals = 18;
      const weiValue = scaleDecimals("1.23456789", decimals);
      chai.expect(weiValue).to.equal("1234567890000000000");
    });

    it("Should handle negative numbers", async () => {
      const decimals = 10;
      const weiValue = scaleDecimals("-123.456789", decimals);
      chai.expect(weiValue).to.equal("-1234567890000");
    });

    it("Should handle zero number", async () => {
      const decimals = 8;
      const weiValue = scaleDecimals("0", decimals);
      chai.expect(weiValue).to.equal("0");
    });

    it("Should handle decimals with trailing zeros", async () => {
      const decimals = 10;
      const weiValue = scaleDecimals("123.400000", decimals);
      chai.expect(weiValue).to.equal("1234000000000");
    });

    it("Should throw an error for value being only a dot", async () => {
      const decimals = 18;
      chai
        .expect(() => scaleDecimals(".", decimals))
        .to.throw(Error, "[ethjs-unit] while converting number . to wei, invalid value");
    });

    it("Should throw an error for too many decimal points", async () => {
      const decimals = 18;
      chai
        .expect(() => scaleDecimals("1.2.3", decimals))
        .to.throw(Error, "[ethjs-unit] while converting number 1.2.3 to wei, too many decimal points");
    });

    it("Should throw an error for too many decimal places", async () => {
      const decimals = 6;
      chai
        .expect(() => scaleDecimals("123.45678321312312312329", decimals))
        .to.throw(
          Error,
          "[ethjs-unit] while converting number 123.45678321312312312329 to wei, too many decimal places"
        );
    });

    it("Should throw an error for invalid characters", async () => {
      const decimals = 18;
      chai
        .expect(() => scaleDecimals("1a2b3c4d", decimals))
        .to.throw(
          Error,
          "while converting number to string, invalid number value '1a2b3c4d', should be a number matching (^-?[0-9.]+)"
        );
    });
  });

  describe("UNIT_CONVERTERS", async () => {
    it("Should return the correct value for valid contract address and valid input format with commas", async () => {
      const value = "123,456.78";
      const contractAddress = "0x04c496af5321D9E03fd10a67CA6C23474bFc8475";
      const fields: Record<string, unknown> = {
        chain: "eip155:1",
        contractAddress,
      };
      const parameters: Record<string, unknown> = {
        parameterName: "parameterValue",
      };

      const result = await UNIT_CONVERTERS[0][1](value, ["unused", contractAddress], fields, parameters);

      chai.expect(result).to.equal("123456780000000000000000");
    });

    it("Should return the correct value for valid contract address and valid input format without commas", async () => {
      // Test case for a contract address with valid input format (without commas)
      const value = "123456.78";
      const contractAddress = "0x04c496af5321D9E03fd10a67CA6C23474bFc8475";
      const fields: Record<string, unknown> = {
        chain: "eip155:1",
        contractAddress,
      };
      const parameters: Record<string, unknown> = {
        parameterName: "parameterValue",
      };

      const result = await UNIT_CONVERTERS[0][1](value, ["unused", contractAddress], fields, parameters);

      chai.expect(result).to.equal("123456780000000000000000");
    });

    it('Should use contractAddress from fields when contractAddress is "@"', async () => {
      const value = "123,456.78";
      const contractAddress = "0x1234567890";
      const fields: Record<string, unknown> = {
        chain: "ethereum",
        contractAddress,
      };
      const parameters: Record<string, unknown> = {
        parameterName: "parameterValue",
      };

      const result = await UNIT_CONVERTERS[0][1](value, ["unused", "@"], fields, parameters);
      chai.expect(result).to.equal("123456780000000000000000");
    });

    it("Should throw an error for invalid contract address", async () => {
      const value = "123,456.78";
      const contractAddress = "invalid-address";
      const fields: Record<string, unknown> = {
        chain: "eip155:1",
        contractAddress,
      };
      const parameters: Record<string, unknown> = {
        parameterName: "parameterValue",
      };

      await chai
        .expect(UNIT_CONVERTERS[0][1](value, ["unused", contractAddress], fields, parameters))
        .to.be.rejectedWith(Error, `erc20Decimals: Invalid contract address: ${contractAddress}`);
    });
  });
});
