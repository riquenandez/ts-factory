declare module "bun" {
  namespace YAML {
    function parse(input: string): unknown;
  }
}
