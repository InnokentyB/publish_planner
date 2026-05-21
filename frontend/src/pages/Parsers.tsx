export default function Parsers() {
    return (
        <div className="flex-1 w-full p-8 lg:p-10 overflow-y-auto">
            <div className="max-w-5xl mx-auto space-y-8">
                <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 lg:p-10">
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Parser Interface</div>
                    <h1 className="mt-3 text-4xl font-headline font-black tracking-tight text-on-surface">Content Parsers</h1>
                    <p className="mt-4 max-w-3xl text-sm leading-7 text-on-surface-variant">
                        This workspace is reserved for external parsers, discovery jobs, channel-specific scraping flows,
                        and MCP-connected ingestion pipelines. We wired the navigation now so the parser layer can be designed
                        as a first-class product area without reshuffling the app again later.
                    </p>
                </section>

                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {[
                        {
                            title: 'Reddit Parser',
                            body: 'Query templates, asynchronous research jobs, extracted pain points, and structured insight feeds for planner handoff.'
                        },
                        {
                            title: 'Channel Discovery',
                            body: 'Per-project parser connectors for gated communities, forums, subreddits, and other future source networks.'
                        },
                        {
                            title: 'MCP Ingestion',
                            body: 'Bring external content, plans, and resource files into project channels through MCP once that layer is finalized.'
                        }
                    ].map((card) => (
                        <div key={card.title} className="rounded-[1.75rem] bg-surface-container-low p-6 border border-outline-variant/10">
                            <div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20">
                                <span className="material-symbols-outlined">hub</span>
                            </div>
                            <h2 className="mt-5 text-xl font-headline font-black text-on-surface">{card.title}</h2>
                            <p className="mt-3 text-sm leading-7 text-on-surface-variant">{card.body}</p>
                        </div>
                    ))}
                </section>
            </div>
        </div>
    )
}
