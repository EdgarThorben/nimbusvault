import type { APIRoute } from "astro";
import { getJob, invoiceLabel } from "../../lib/jobs";
import { renderInvoicePdf } from "../../lib/invoicePdf";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  const job = await getJob(params.id ?? "");
  if (!job || job.invoiceNumber === null || !job.invoicedAt) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = await renderInvoicePdf({
    invoiceNumber: job.invoiceNumber,
    invoicedAt: job.invoicedAt,
    title: job.title,
    plate: job.plate,
    makeModel: job.makeModel,
    customerName: job.customerName,
    customerEmail: job.customerEmail,
    customerPhone: job.customerPhone,
    lines: job.lines,
  });

  return new Response(new Blob([bytes as BlobPart], { type: "application/pdf" }), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${invoiceLabel(job.invoiceNumber)}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
};
