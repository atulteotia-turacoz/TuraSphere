"""Co-author network analysis using NetworkX for PageRank computation."""
import networkx as nx
from typing import Dict, Optional, Tuple


class NetworkService:

    @staticmethod
    def build_coauthor_graph(coauthor_data: Dict[str, Dict[str, int]]) -> nx.Graph:
        """Build a co-authorship graph. coauthor_data maps author -> {coauthor: count}."""
        G = nx.Graph()
        for author, coauthors in coauthor_data.items():
            G.add_node(author)
            for coauthor, weight in coauthors.items():
                G.add_edge(author, coauthor, weight=weight)
        return G

    @staticmethod
    def compute_pagerank(G: nx.Graph) -> Dict[str, float]:
        if len(G.nodes()) == 0:
            return {}
        return nx.pagerank(G, weight="weight")

    @staticmethod
    def get_author_percentile(pagerank_scores: Dict[str, float], author_name: str) -> Optional[float]:
        if not pagerank_scores or author_name not in pagerank_scores:
            return None
        author_score = pagerank_scores[author_name]
        total = len(pagerank_scores)
        rank = sum(1 for v in pagerank_scores.values() if v <= author_score)
        return (rank / total) * 100

    @staticmethod
    def analyze_author_network(coauthor_counts: Dict[str, int],
                                target_author: str) -> Tuple[Optional[float], int]:
        """Quick analysis: build a simple star graph and return metrics."""
        if not coauthor_counts:
            return None, 0

        G = nx.Graph()
        G.add_node(target_author)
        for coauthor, count in coauthor_counts.items():
            G.add_node(coauthor)
            G.add_edge(target_author, coauthor, weight=count)
            # Add some edges between co-authors (approximation)
            for other_coauthor, other_count in coauthor_counts.items():
                if other_coauthor != coauthor and other_count > 1 and count > 1:
                    G.add_edge(coauthor, other_coauthor, weight=1)

        pagerank = nx.pagerank(G, weight="weight")
        percentile = NetworkService.get_author_percentile(pagerank, target_author)
        coauthor_count = len(coauthor_counts)

        return percentile, coauthor_count
