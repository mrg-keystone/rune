// Scaffolded once; fill in the bodies. `sync` preserves this file.

import { InvoiceDto } from "@/src/billing/dto/invoice.ts";
import { IssueDto } from "@/src/billing/dto/issue.ts";

export class Invoice {
  save(issueDto: IssueDto): Promise<InvoiceDto> {
    throw new Error("not implemented");
  }
}
