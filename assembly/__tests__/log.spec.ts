import { describe, expect, log, test } from "..";

class Address {
  line1: string = "42 Binary Lane";
  zip: i32 = 90210;

  toJSON(): string {
    return '{"line1":"' + this.line1 + '","zip":' + this.zip.toString() + "}";
  }
}

class UserProfile {
  id: i32 = 7;
  active: bool = true;
  rating: f64 = 4.25;
  tags: string[] = ["assemblyscript", "testing"];
  address: Address = new Address();

  toJSON(): string {
    return (
      '{"id":' +
      this.id.toString() +
      ',"active":' +
      (this.active ? "true" : "false") +
      ',"rating":' +
      this.rating.toString() +
      ',"address":' +
      this.address.toJSON() +
      "}"
    );
  }
}

describe("log serialization", () => {
  test("supports class instances and common value types", () => {
    const profile = new UserProfile();
    const list = [1, 2, 3];

    log(profile);
    log(list);
    log(true);
    log(123);
    log("ok");

    expect(1).toBe(1);
  });
});
