import chai from "chai";
import { numberToString, scaleDecimals } from "../web3/evm/unitConverter";

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

  it("Should throw an error for too many decimal points", async () => {
    const decimals = 18;
    chai
      .expect(() => scaleDecimals("1.2.3", decimals))
      .to.throw(Error, "[ethjs-unit] while converting number 1.2.3 to wei,  too many decimal points");
  });

  it("Should throw an error for too many decimal places", async () => {
    const decimals = 6;
    chai
      .expect(() => scaleDecimals("123.45678321312312312329", decimals))
      .to.throw(Error, "[ethjs-unit] while converting number 123.45678321312312312329 to wei, too many decimal places");
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
