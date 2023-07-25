import chai from "chai";
import chaiHttp from "chai-http";
import { isSameAddress, parseEventDeclaration } from "../web3/evm/utils";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);

describe("EVM utils tests", async function () {
  describe("isSameAddress (address A and address B)", async function () {
    it("Should return true if both two addresses are egal (case sensitive)", async function () {
      chai.expect(
        isSameAddress("0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E", "0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E")
      ).to.be.true;
    });

    it("Should return true if both two addresses are egal (case insensitive)", async function () {
      chai.expect(
        isSameAddress("0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E", "0x71fa225b8f9aeb50b44f96743275837f8eb7694e")
      ).to.be.true;
    });

    it("Should return false if address A is null", async function () {
      chai.expect(isSameAddress(null, "0x71fa225b8f9aeb50b44f96743275837f8eb7694e")).to.be.false;
    });

    it("Should return false if address B is null", async function () {
      chai.expect(isSameAddress("0x71fa225b8f9aeb50b44f96743275837f8eb7694e", null)).to.be.false;
    });

    it("Should return false if address A and address B are null", async function () {
      chai.expect(isSameAddress(null, null)).to.be.false;
    });
  });

  describe("parseEventDeclaration", async function () {
    it("Should throw error if name does not appear at the beginning", async function () {
      chai
        .expect(() => parseEventDeclaration("(address previousAdmin, address newAdmin);"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration");
    });

    it("Should throw error if parenthesis does not appear after event name", async function () {
      chai
        .expect(() => parseEventDeclaration("event AdminChanged address previousAdmin, address newAdmin);"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration");
    });

    it("Should throw error if parenthesis does not appear at the end", async function () {
      chai
        .expect(() => parseEventDeclaration("event AdminChanged (address previousAdmin, address newAdmin"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration");
    });

    it("Should render correct event parsing for classical events with ; at the end", async function () {
      chai.expect(parseEventDeclaration("event AdminChanged(address previousAdmin, address newAdmin);")).to.deep.equal({
        name: "AdminChanged",
        inputs: [
          { indexed: false, type: "address", name: "previousAdmin" },
          { indexed: false, type: "address", name: "newAdmin" },
        ],
        type: "event",
        anonymous: false,
      });
    });

    it("Should render correct event parsing for classical events without ; at the end", async function () {
      chai.expect(parseEventDeclaration("event AdminChanged(address previousAdmin, address newAdmin)")).to.deep.equal({
        name: "AdminChanged",
        inputs: [
          { indexed: false, type: "address", name: "previousAdmin" },
          { indexed: false, type: "address", name: "newAdmin" },
        ],
        type: "event",
        anonymous: false,
      });
    });

    it("Should render correct event parsing for classical events without event prefix at the beginning", async function () {
      chai.expect(parseEventDeclaration("AdminChanged(address previousAdmin, address newAdmin)")).to.deep.equal({
        name: "AdminChanged",
        inputs: [
          { indexed: false, type: "address", name: "previousAdmin" },
          { indexed: false, type: "address", name: "newAdmin" },
        ],
        type: "event",
        anonymous: false,
      });
    });

    it("Should render correct event parsing for classical events with random spaces", async function () {
      chai
        .expect(parseEventDeclaration("event     AdminChanged (  address   previousAdmin ,   address newAdmin  )  "))
        .to.deep.equal({
          name: "AdminChanged",
          inputs: [
            { indexed: false, type: "address", name: "previousAdmin" },
            { indexed: false, type: "address", name: "newAdmin" },
          ],
          type: "event",
          anonymous: false,
        });
    });

    it("Should render correct event parsing with arrays", async function () {
      chai
        .expect(
          parseEventDeclaration(
            "event ExecutedWithSuccess(address[] _assets, uint256[] _amounts, uint256[] _premiums);"
          )
        )
        .to.deep.equal({
          name: "ExecutedWithSuccess",
          inputs: [
            { indexed: false, type: "address[]", name: "_assets" },
            { indexed: false, type: "uint256[]", name: "_amounts" },
            { indexed: false, type: "uint256[]", name: "_premiums" },
          ],
          type: "event",
          anonymous: false,
        });
    });

    it("Should render correct event parsing with indexed arguments", async function () {
      chai
        .expect(parseEventDeclaration("event AssetSourceUpdated(address indexed asset, address indexed source)"))
        .to.deep.equal({
          name: "AssetSourceUpdated",
          inputs: [
            { indexed: true, type: "address", name: "asset" },
            { indexed: true, type: "address", name: "source" },
          ],
          type: "event",
          anonymous: false,
        });
    });

    it("Should throw error if one parameter type is missing", async function () {
      chai
        .expect(() => parseEventDeclaration("event AdminChanged(previousAdmin, address newAdmin)"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration: Invalid parameter previousAdmin");
    });

    it("Should throw error if one parameter does not have name", async function () {
      chai
        .expect(() => parseEventDeclaration("event AdminChanged(address, address newAdmin)"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration: Invalid parameter address");
    });

    it("Should throw error if one parameter has type + something that is not indexed + name", async function () {
      chai
        .expect(() => parseEventDeclaration("event AdminChanged(address not_indexed previousAdmin, address newAdmin)"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration: Invalid parameter address not_indexed previousAdmin");
    });
  });
});
