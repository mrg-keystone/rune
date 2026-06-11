// Scaffolded once; fill in the bodies. `sync` preserves this file.

import { ListDto } from "@/src/catalog/dto/list.ts";
import { ProductsDto } from "@/src/catalog/dto/products.ts";

export class Product {
  query(listDto: ListDto): Promise<ProductsDto> {
    throw new Error("not implemented");
  }
}
