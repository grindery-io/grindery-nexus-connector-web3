import chai from "chai";
import chaiExclude from "chai-exclude";
import chaiHttp from "chai-http";
import { mockedToken } from "./utils";
import { parseUserAccessToken } from "../jwt";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiHttp);
chai.use(chaiExclude);
chai.use(chaiAsPromised);

let userToken: string;

before(async () => {
  userToken = await mockedToken;
});

describe("JWT", function () {
  describe("parseUserAccessToken", function () {
    it("Should return the proper payload for access token", async function () {
      chai
        .expect(await parseUserAccessToken(userToken))
        .excluding(["iat", "exp"])
        .to.deep.equal({
          aud: "urn:grindery:access-token:v1",
          sub: "eip155:1:0x10A2C306cCc87938B1fe3c63DBb1457A9c810df5",
          iss: "urn:grindery:orchestrator",
        });
    });

    it("Should return an error if token has wrong format", async function () {
      await chai
        .expect(parseUserAccessToken("invalidToken"))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "Invalid Compact JWS");
    });

    it("Should return an error if token is invalid", async function () {
      await chai
        .expect(
          parseUserAccessToken(
            "eyJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHgxMEEyQzMwNmNDYzg3OTM4QjFmZTNjNjNEQmIxNDU3QTljODEwZGY1IiwiaWF0IjoxNjkyMjg4NjA2LCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjkyMjkyMjA2fQ.QK-WlxdiOYtiDUh_YIkMu82R-0QT7UW7637sZ0kWAZucaL6XUoVZjkFI54gDoQfW6ZtnlJWEBOEVsj41jAfgfD"
          )
        )
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.property("message", "signature verification failed");
    });
  });
});
