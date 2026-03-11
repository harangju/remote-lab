# Compression Theory of Organizations

Organizations are lossy compression algorithms for bounded processors. The constraints are universal: they apply to any bounded processor, not just humans.

Collaboration with [Kieran Murphy](https://kieranamurphy.com/).

## The Frontier

![The Frontier](/frontier.png)

The phase space of computation. The diagonal from bottom-left (Rock) to top-right (Multi-Agent Systems) is the **scaling frontier** — analogous to the **Production Possibility Frontier (PPF)**. With a fixed resource budget, you choose:

- Invest in **smarter individual nodes** (move right on x-axis: unit capability $u$)
- Invest in **more complex coordination** (move up on y-axis: network complexity $n$)

The frontier is maximum computation for your current $u$ and $n$. Systems below the frontier are **computationally inefficient** — they have the parts, but not the performance. What determines how much of the frontier you actually reach? That's η — architectural efficiency.

$$C_{\text{realized}} = \eta \cdot f(n, u)$$

## Compression

Why η? Because when a problem is bigger than what one node can hold, compression is forced. Every organizational feature is a compression function:

| Feature | Compression Function | Why It's Lossy |
|---------|---------------------|----------------|
| Hierarchy | Each layer summarizes for the layer above | Information degrades at every interface |
| Departments | You only need to understand your domain | Silos form; each optimizes its own scheme |
| Roles | Infinite actions → finite expectations | Possibility space is artificially constrained |
| Processes | Standardization avoids rethinking | Bureaucracy emerges; context is lost |
| Meetings | Real-time translation between contexts | Expensive, slow, synchronous |
| Strategy | Infinite possibilities → finite direction | Intent degrades through multiple decompressions |
| Culture | Shared assumptions reduce explicit communication | Implicit compression is hard to change |

Middle managers are **compression/decompression nodes**: upward (thousands of hours → paragraph summary), downward (abstract intent → concrete actions). This is most of what management IS.

Compression quality at each node depends on **bandwidth** (how much you can hold before compressing) and **algorithm** (how well you preserve what matters when you do compress). AI agents improve on both: massive context windows + learnable compression.

## CKP Formalization

What governs η? Three parameters:

- **C** — Context limits (how much a single node can hold/process)
- **K** — Coordination costs (overhead of connecting nodes)
- **P** — Problem complexity (demands of the task)

$$\eta = \eta(C, K, P)$$

Kieran brings rigor on **C** (information bottleneck formalism, compression bounds), I bring **K** (org theory, Coase), **P** is shared.

How η decomposes:
- **$P$ sets the scale:** $P > C$ → organization is forced
- **$C$ determines compression depth:** minimum layers $L \geq \lceil P / C \rceil$
- **$C$ determines compression fidelity:** each hop preserves fraction $\rho(C) \leq 1$ of signal
- **$P$ and $C$ together determine signal survival:** $\rho(C)^{\lceil P/C \rceil}$ — compounds across layers (why deep hierarchies lose so much; why harder problems lose more)
- **$K$ is the coordination tax:** each hop costs $K$, total overhead $\sim L \cdot K$

η captures: how much signal survives ($\rho^L$) minus how much you pay for the hops ($L \cdot K$), where $L$ is set by $P/C$. The frontier curves because more nodes let you distribute $P$, but each connection costs $K$ and each compression step loses $1 - \rho$.

**TODO (with Kieran):** formalize $\rho(C)$ — what does the information bottleneck say about optimal compression under context limit $C$? This is where the real math lives.

### The Canon

- **Simon** (bounded rationality) = $C$. Every organizational feature answers: "how do we coordinate when no one can hold the whole problem?"
- **Coase** (transaction costs) = $K$. Firms exist when internal coordination costs < external transaction costs.
- **Thompson** (interdependence) = the structure of $P$. Pooled, sequential, reciprocal interdependence → different compression architectures.
- **Galbraith** (information processing) = the interaction. Design depends on uncertainty (a function of $P$ and $C$).

## Predictions

Given human parameters ($C_{\text{human}}$, $K_{\text{human}}$):
- Deep hierarchies (low $C$ → many compression layers)
- Rigid departments (high $K$ → minimize coordination interfaces)
- Standardized processes (reduce per-hop compression effort)
- Many meetings (expensive decompression rituals)

Given AI agent parameters ($C_{\text{agent}} \gg C_{\text{human}}$, potentially lower $K$):
- Flatter structures (high $C$ → fewer layers needed)
- Fluid boundaries (lower $K$ → more interfaces affordable)
- Adaptive processes (agents evaluate with full context)
- Async coordination (agents maintain shared context continuously)

**This is the core prediction:** changing C and K produces different organizational forms. Testable.

The AMR contribution: not "orgs are like compression" but "given C, K, P, these structures are the necessary solution."

## Open Questions

- Can we formally derive known org structures from CKP? (the "theorem" aspiration)
- How does error propagation work across hierarchical compression?
- Do different compression schemes (abstractions) have measurable tradeoffs?
- What's the right mathematical framework? (Information bottleneck? Rate-distortion theory?)
- Overlay "Inefficiency Zones" on the frontier

## References

- **Scaling laws:** OpenAI (Kaplan et al., 2020), DeepMind (Hoffmann et al., 2022)
- **Collective intelligence:** Thomas Malone, MIT — c-factor depends on connection quality, not sum of individual IQs
- **Agentic scaling:** *"More Agents Is All You Need"*, *"Science of Scaling Agent Systems"* (2024-2026)
- **Bias as information loss:** all cognitive bias (human or machine) is information loss from compression — context limits force compression; what's lost creates systematic bias
- **Diversity as multiple compression schemes:** diverse perspectives preserve different information; combining them recovers more signal (research direction with Matt DiSorbo on LLM context bias; Jules Agent planning critics)
- **Examples:** 10,000 geniuses with bad bureaucracy → low η → same output as a tiny startup; naive LLM loop has lower η than tree-of-thought with same model
