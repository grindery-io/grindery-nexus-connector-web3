import chai from "chai";
import chaiHttp from "chai-http";
import { isSameAddress, parseFunctionDeclaration } from "../web3/evm/utils";

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

  describe("parseFunctionDeclaration", async function () {
    it("Should throw error if name does not appear at the beginning", async function () {
      chai
        .expect(() => parseFunctionDeclaration("(bytes32 args, bytes32 r, bytes32 s) external"))
        .to.throw(Error)
        .with.property("message", "Invalid function declaration");
    });

    it("Should throw error if parenthesis is missing after function name", async function () {
      chai
        .expect(() =>
          parseFunctionDeclaration("function supplyWithPermit bytes32 args, bytes32 r, bytes32 s) external")
        )
        .to.throw(Error)
        .with.property("message", "Invalid function declaration");
    });

    it("Should throw error if parenthesis is missing after argument declaration", async function () {
      chai
        .expect(() =>
          parseFunctionDeclaration("function supplyWithPermit (bytes32 args, bytes32 r, bytes32 s external")
        )
        .to.throw(Error)
        .with.property("message", "Invalid function declaration");
    });

    it("Should throw error if parenthesis is missing after argument declaration", async function () {
      chai
        .expect(() =>
          parseFunctionDeclaration("function supplyWithPermit (bytes32 args, bytes32 r, bytes32 s external")
        )
        .to.throw(Error)
        .with.property("message", "Invalid function declaration");
    });

    it("Should throw error if one argument name is missing", async function () {
      chai
        .expect(() => parseFunctionDeclaration("function supplyWithPermit (bytes32, bytes32 r, bytes32 s) external;"))
        .to.throw(Error)
        .with.property("message", "Invalid function declaration: Invalid parameter bytes32");
    });

    it("Should throw error if one argument type is missing", async function () {
      chai
        .expect(() => parseFunctionDeclaration("function supplyWithPermit (args, bytes32 r, bytes32 s) external;"))
        .to.throw(Error)
        .with.property("message", "Invalid function declaration: Invalid parameter args");
    });

    it("Should render correct function parsing for function with ; at the end", async function () {
      chai
        .expect(parseFunctionDeclaration("function supplyWithPermit (bytes32 args, bytes32 r, bytes32 s) external;"))
        .to.deep.equal({
          name: "supplyWithPermit",
          inputs: [
            { type: "bytes32", name: "args" },
            { type: "bytes32", name: "r" },
            { type: "bytes32", name: "s" },
          ],
          outputs: [],
          constant: false,
          payable: false,
          stateMutability: "nonpayable",
          type: "function",
        });
    });

    it("Should render correct function parsing for function without ; at the end", async function () {
      chai
        .expect(parseFunctionDeclaration("function supplyWithPermit (bytes32 args, bytes32 r, bytes32 s) external"))
        .to.deep.equal({
          name: "supplyWithPermit",
          inputs: [
            { type: "bytes32", name: "args" },
            { type: "bytes32", name: "r" },
            { type: "bytes32", name: "s" },
          ],
          outputs: [],
          constant: false,
          payable: false,
          stateMutability: "nonpayable",
          type: "function",
        });
    });

    it("Should handle outputs properly", async function () {
      chai
        .expect(parseFunctionDeclaration("function getSiloedBorrowingState() public view returns (bool[], address)"))
        .to.deep.equal({
          name: "getSiloedBorrowingState",
          inputs: [],
          outputs: [
            { type: "bool[]", name: "return0" },
            { type: "address", name: "return1" },
          ],
          constant: true,
          payable: false,
          stateMutability: "view",
          type: "function",
        });
    });

    it("Should render correct function parsing for function calldata/memory arguments", async function () {
      chai
        .expect(
          parseFunctionDeclaration(
            "function setAssetSources(address[] calldata assets, address[] calldata sources) external override onlyAssetListingOrPoolAdmins"
          )
        )
        .to.deep.equal({
          name: "setAssetSources",
          inputs: [
            { type: "address[]", name: "assets" },
            { type: "address[]", name: "sources" },
          ],
          outputs: [],
          constant: false,
          payable: false,
          stateMutability: "nonpayable",
          type: "function",
        });
    });

    it("Should handle payable function", async function () {
      chai
        .expect(parseFunctionDeclaration("function destroyAndTransfer(address payable to) external payable"))
        .to.deep.equal({
          name: "destroyAndTransfer",
          inputs: [{ type: "address", name: "to" }],
          outputs: [],
          constant: false,
          payable: true,
          stateMutability: "payable",
          type: "function",
        });
    });

    it("Should handle view function", async function () {
      chai
        .expect(parseFunctionDeclaration("function ASSET_LISTING_ADMIN_ROLE() external view returns (bytes32)"))
        .to.deep.equal({
          name: "ASSET_LISTING_ADMIN_ROLE",
          inputs: [],
          outputs: [{ type: "bytes32", name: "return0" }],
          constant: true,
          payable: false,
          stateMutability: "view",
          type: "function",
        });
    });

    it("Should handle pure function", async function () {
      chai
        .expect(parseFunctionDeclaration("function getRevision() internal pure override returns (uint256)"))
        .to.deep.equal({
          name: "getRevision",
          inputs: [],
          outputs: [{ type: "uint256", name: "return0" }],
          constant: false,
          payable: false,
          stateMutability: "pure",
          type: "function",
        });
    });
  });
});
