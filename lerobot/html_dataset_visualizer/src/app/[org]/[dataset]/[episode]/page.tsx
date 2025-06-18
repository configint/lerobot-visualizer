import EpisodeViewer from "./episode-viewer";
import { getEpisodeDataSafe } from "./fetch-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { org: string; dataset: string; episode: string };
}) {
  const { org, dataset, episode } = params;
  let organization = org;
  let datasetName = dataset;
  if (/^\d+(\.\d+)*$/.test(org)) {
    const tokens = dataset.split("-");
    organization = tokens[0];
    datasetName = tokens.slice(1).join("-") || tokens[0];
  }
  return {
    title: `${organization}/${datasetName} | episode ${episode}`,
  };
}

export default async function EpisodePage({
  params,
}: {
  params: { org: string; dataset: string; episode: string };
}) {
  // episode is like 'episode_0'
  const { org, dataset, episode } = params;
  // fetchData should be updated if needed to support this path pattern
  const episodeNumber = Number(episode.replace(/^episode_/, ""));
  const { data, error } = await getEpisodeDataSafe(org, dataset, episodeNumber);
  return <EpisodeViewer data={data} error={error} />;
}
