import { useNavigate } from 'react-router-dom'

export default function Guide() {
    const navigate = useNavigate()

    const steps = [
        {
            title: "1. Выбор проекта",
            description: "Начните с выбора нужного проекта в боковой панели. Это инициализирует ваше когнитивное пространство и загрузит настройки конкретного бренда.",
            image: "/guide_step1.png",
            icon: "folder_open"
        },
        {
            title: "2. Стратегический квартал",
            description: "В «Factory Matrix» перейдите на вкладку «Quarter Architecture». Одним промптом создайте стратегию на 3 месяца, которая развернется в логическую цепочку контентных арок.",
            image: "/guide_step2.png",
            icon: "architecture"
        },
        {
            title: "3. Тактическая неделя",
            description: "Разверните неделю из квартального плана или создайте новую. Внутри вы увидите «Sync Nodes» — узлы генерации для каждого поста. Проверьте тезисы и план перед запуском.",
            image: "/guide_step3.png",
            icon: "event_upcoming"
        },
        {
            title: "4. Factory Sweep",
            description: "Нажмите «Run Sweep» на главном экране заполнителя или внутри недели. AI-агенты пройдут по всем узлам, генерируя тексты, подбирая теги и создавая визуальный контент в едином стиле.",
            image: "/guide_step4.png",
            icon: "cyclone"
        }
    ]

    return (
        <div className="flex-1 w-full p-8 max-h-full overflow-y-auto space-y-12 scrollbar-hide bg-surface">
            {/* Header */}
            <div className="flex justify-between items-end max-w-5xl mx-auto">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <span className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest rounded-full">Onboarding</span>
                        <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
                    </div>
                    <h1 className="text-4xl font-headline font-black tracking-tight text-on-surface">Инструкция по работе с Заводом</h1>
                    <p className="text-on-surface-variant font-body mt-2">Ваш путь от первой идеи до готового контент-плана.</p>
                </div>
                <button 
                    onClick={() => navigate('/orchestrator')}
                    className="flex items-center gap-2 bg-surface-container-high hover:bg-surface-container-highest px-6 py-3 rounded-2xl font-bold text-sm transition-all"
                >
                    <span className="material-symbols-outlined text-lg">arrow_back</span>
                    <span>Вернуться в Матрицу</span>
                </button>
            </div>

            {/* Steps Feed */}
            <div className="max-w-5xl mx-auto space-y-24 pb-24">
                {steps.map((step, index) => (
                    <div key={index} className={`flex flex-col lg:flex-row gap-12 items-center ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
                        {/* Text Side */}
                        <div className="flex-1 space-y-6">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 ai-gradient text-white rounded-2xl flex items-center justify-center shadow-lg">
                                    <span className="material-symbols-outlined">{step.icon}</span>
                                </div>
                                <h2 className="text-3xl font-headline font-black text-on-surface tracking-tight">{step.title}</h2>
                            </div>
                            <p className="text-lg text-on-surface-variant leading-relaxed font-body italic border-l-4 border-primary/20 pl-6">
                                {step.description}
                            </p>
                        </div>

                        {/* Image Side */}
                        <div className="flex-1 group">
                            <div className="relative rounded-[2.5rem] overflow-hidden border border-outline-variant/10 shadow-2xl transition-transform duration-500 group-hover:scale-[1.02]">
                                <img 
                                    src={step.image} 
                                    alt={step.title} 
                                    className="w-full aspect-video object-cover"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end p-8">
                                    <span className="text-white/60 text-xs font-bold uppercase tracking-widest">Визуальный референс интерфейса</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

                {/* Final CTA */}
                <div className="glass-panel p-12 rounded-[3rem] text-center border border-primary/20 shadow-3xl">
                    <h3 className="text-3xl font-headline font-black text-on-surface mb-4">Готовы к запуску?</h3>
                    <p className="text-on-surface-variant mb-10 max-w-lg mx-auto leading-relaxed font-body">
                        Все инструменты настроены и ждут вашей команды. Начните проектирование своего первого квартала прямо сейчас.
                    </p>
                    <button 
                        onClick={() => navigate('/orchestrator')}
                        className="ai-gradient text-white font-black px-12 py-5 rounded-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all text-lg"
                    >
                        Запустить Матрицу
                    </button>
                </div>
            </div>
        </div>
    )
}
