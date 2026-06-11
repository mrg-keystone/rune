// Scaffolded once; fill in the bodies. `sync` preserves this file.

import { PayDto } from "@/src/checkout/dto/pay.ts";
import { ReceiptDto } from "@/src/checkout/dto/receipt.ts";

export class Payment {
  charge(payDto: PayDto): Promise<ReceiptDto> {
    throw new Error("not implemented");
  }
}
