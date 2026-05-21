'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import postgres from 'postgres';
import { z } from 'zod';
import {
  createLocalInvoice,
  deleteLocalInvoice,
  updateLocalInvoice,
} from './local-store';

let sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!process.env.POSTGRES_URL) {
    return null;
  }

  if (!sql) {
    sql = postgres(process.env.POSTGRES_URL, { ssl: 'require' });
  }

  return sql;
}

const FormSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: z.coerce.number(),
  status: z.enum(['pending', 'paid']),
  date: z.string(),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

export async function createInvoice(formData: FormData) {
  const { customerId, amount, status } = CreateInvoice.parse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
  const amountInCents = Math.round(amount * 100);
  const date = new Date().toISOString().split('T')[0];
  const db = getSql();

  if (db) {
    await db`
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
  } else {
    await createLocalInvoice({ customerId, amountInCents, status });
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function updateInvoice(id: string, formData: FormData) {
  const { customerId, amount, status } = UpdateInvoice.parse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
  const amountInCents = Math.round(amount * 100);
  const db = getSql();

  if (db) {
    await db`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
  } else {
    await updateLocalInvoice(id, { customerId, amountInCents, status });
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function deleteInvoice(id: string) {
  const db = getSql();

  if (db) {
    await db`DELETE FROM invoices WHERE id = ${id}`;
  } else {
    await deleteLocalInvoice(id);
  }

  revalidatePath('/dashboard/invoices');
}
