import chai from "chai";
import chaiHttp from "chai-http";
import { isSameAddress, parseFunctionDeclaration, parseEventDeclaration, getUserAddress } from "../web3/evm/utils";
import { mockedTAccessToken } from "./utils";
import chaiAsPromised from "chai-as-promised";

/* eslint-disable no-unused-expressions */

chai.use(chaiHttp);
chai.use(chaiAsPromised);

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
    it("Should throw error if function prefix does not follow function name at the beginning", async function () {
      chai
        .expect(() => parseFunctionDeclaration("function (bytes32 args, bytes32 r, bytes32 s) external"))
        .to.throw(Error)
        .with.property("message", "Invalid function declaration");
    });

    it("Should throw error if function name does not appear at the beginning", async function () {
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

    it("Should throw error if parenthesis is missing after argument declarations", async function () {
      chai
        .expect(() =>
          parseFunctionDeclaration("function supplyWithPermit (bytes32 args, bytes32 r, bytes32 s external")
        )
        .to.throw(Error)
        .with.property("message", "Invalid function declaration");
    });

    it("Should throw error if one argument name is missing", async function () {
      chai
        .expect(() =>
          parseFunctionDeclaration("function supplyWithPermit (bytes32 args, bytes32, bytes32 s) external;")
        )
        .to.throw(Error)
        .with.property("message", "Invalid function declaration: Invalid parameter bytes32");
    });

    it("Should throw error if one argument type is missing", async function () {
      chai
        .expect(() => parseFunctionDeclaration("function supplyWithPermit (bytes32 args, r, bytes32 s) external;"))
        .to.throw(Error)
        .with.property("message", "Invalid function declaration: Invalid parameter r");
    });

    it("Should render correct function parsing for function without function prefix", async function () {
      chai
        .expect(parseFunctionDeclaration("supplyWithPermit (bytes32 args, bytes32 r, bytes32 s) external;"))
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

    it("Should render correct function parsing with random spaces", async function () {
      chai
        .expect(
          parseFunctionDeclaration(
            "function     supplyWithPermit    (  bytes32 args  ,  bytes32 r, bytes32 s  ) external"
          )
        )
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

    it("Should render correct function parsing for function calldata arguments", async function () {
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

    it("Should render correct function parsing for function memory arguments", async function () {
      chai
        .expect(
          parseFunctionDeclaration(
            "function calculateInterestRates(DataTypes.CalculateInterestRatesParams memory params) external view returns (uint256, uint256, uint256)"
          )
        )
        .to.deep.equal({
          name: "calculateInterestRates",
          inputs: [{ type: "DataTypes.CalculateInterestRatesParams", name: "params" }],
          outputs: [
            { type: "uint256", name: "return0" },
            { type: "uint256", name: "return1" },
            { type: "uint256", name: "return2" },
          ],
          constant: true,
          payable: false,
          stateMutability: "view",
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

  describe("parseEventDeclaration", async function () {
    it("Should throw error if event prefix does not follow event name at the beginning", async function () {
      chai
        .expect(() => parseEventDeclaration("event (address previousAdmin, address newAdmin);"))
        .to.throw(Error)
        .with.property("message", "Invalid event declaration");
    });

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

    it("Should render correct event parsing for event without event prefix", async function () {
      chai.expect(parseEventDeclaration("AdminChanged(address previousAdmin, address newAdmin);")).to.deep.equal({
        name: "AdminChanged",
        inputs: [
          { indexed: false, type: "address", name: "previousAdmin" },
          { indexed: false, type: "address", name: "newAdmin" },
        ],
        type: "event",
        anonymous: false,
      });
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
        .expect(() => parseEventDeclaration("event AdminChanged(   previousAdmin, address newAdmin)"))
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

  describe("getUserAddress", async function () {
    it("Should return correct output user address with lower case input (lower case output)", async function () {
      chai
        .expect(
          await getUserAddress({ ...mockedTAccessToken, sub: "eip155:1:0x71fa225b8f9aeb50b44f96743275837f8eb7694e" })
        )
        .to.equal("0x71fa225b8f9aeb50b44f96743275837f8eb7694e");
    });

    it("Should return correct output user address with upper case input (upper case output)", async function () {
      chai
        .expect(
          await getUserAddress({ ...mockedTAccessToken, sub: "eip155:1:0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E" })
        )
        .to.equal("0x71Fa225B8f9AEB50B44f96743275837f8Eb7694E");
    });

    it("Should return an error if sub input address has a wrong checksum", async function () {
      await chai
        .expect(getUserAddress({ ...mockedTAccessToken, sub: "eip155:1:0xC1912fEE45d61C87Cc5EA59DaE31190FFFFf232d" }))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Unexpected eip155 user ID format");
    });

    it("Should return an error if number of elements in address is wrong", async function () {
      await chai
        .expect(getUserAddress({ ...mockedTAccessToken, sub: "eip155:1:0x71fa225b8f9aeb50b44f96743275837f8eb7694" }))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Unexpected eip155 user ID format");
    });

    it("Should return hmac custom address if result of regex on sub is null", async function () {
      chai
        .expect(await getUserAddress({ ...mockedTAccessToken, sub: "87Cc5EA59DaE31190FFFFf232d" }))
        .to.equal("0x3f2ec2a36aB9AFCe37CAD374358F89d221974528");
    });

    it("Should return hmac custom address if there is a workspace field in access token input", async function () {
      chai
        .expect(await getUserAddress({ ...mockedTAccessToken, workspace: "3275837f8eb7694" }))
        .to.equal("0xD3C27521548007CC5E3a6F29f37206a90F2CD090");
    });

    it("Should return hmac custom address if access token sub is empty string", async function () {
      chai
        .expect(await getUserAddress({ ...mockedTAccessToken, sub: "" }))
        .to.equal("0x6242359149968c71184a643f5b905CdbaB37a442");
    });

    it("Should return hmac custom address if access token sub is undefined", async function () {
      chai
        .expect(await getUserAddress({ ...mockedTAccessToken, sub: undefined }))
        .to.equal("0x6AB495913768f9D0F51fe19030Ba16a237E1E55E");
    });
  });
});
