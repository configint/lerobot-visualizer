import { redirect } from "next/navigation";

export default async function DatasetRootPage({
  params,
}: {
  params: Promise<{ org: string; dataset: string }>;
}) {
  const { org, dataset } = await params;
  redirect(`/${org}/${dataset}/episode_1`);
  return null;
}
