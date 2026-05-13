import { describe, expect, it } from "as-test";
// Import JSON and bs directly from json-as.
// bs import prevents json-as transform from adding broken pnpm paths.
import { JSON } from "json-as/assembly";


@json
class SimpleData {
  name: string = "";
  count: i32 = 0;
}


@json
class NestedData {
  id: string = "";
  items: string[] = [];
}

describe("JSON", () => {
  describe("stringify", () => {
    it("should serialize a simple class", () => {
      const data = new SimpleData();
      data.name = "test";
      data.count = 42;

      const json = JSON.stringify(data);

      expect(json).toBe('{"name":"test","count":42}');
    });

    it("should serialize a class with arrays", () => {
      const data = new NestedData();
      data.id = "abc123";
      data.items = ["item1", "item2"];

      const json = JSON.stringify(data);

      expect(json).toBe('{"id":"abc123","items":["item1","item2"]}');
    });

    it("should serialize primitive types", () => {
      expect(JSON.stringify<i32>(42)).toBe("42");
      expect(JSON.stringify<bool>(true)).toBe("true");
      expect(JSON.stringify<string>("hello")).toBe('"hello"');
    });

    it("should serialize arrays", () => {
      const arr: i32[] = [1, 2, 3];
      expect(JSON.stringify(arr)).toBe("[1,2,3]");
    });
  });

  describe("parse", () => {
    it("should deserialize a simple class", () => {
      const json = '{"name":"test","count":42}';
      const data = JSON.parse<SimpleData>(json);

      expect(data.name).toBe("test");
      expect(data.count).toBe(42);
    });

    it("should deserialize a class with arrays", () => {
      const json = '{"id":"abc123","items":["item1","item2"]}';
      const data = JSON.parse<NestedData>(json);

      expect(data.id).toBe("abc123");
      expect(data.items.length).toBe(2);
      expect(data.items[0]).toBe("item1");
      expect(data.items[1]).toBe("item2");
    });

    it("should round-trip data correctly", () => {
      const original = new SimpleData();
      original.name = "round-trip";
      original.count = 123;

      const json = JSON.stringify(original);
      const restored = JSON.parse<SimpleData>(json);

      expect(restored.name).toBe(original.name);
      expect(restored.count).toBe(original.count);
    });
  });
});
