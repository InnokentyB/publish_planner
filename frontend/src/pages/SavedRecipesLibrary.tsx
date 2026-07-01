import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parserApi } from '../api'
import { useAuth } from '../context/AuthContext'

type JsonRecord = Record<string, any>

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function parseTemplates(payload: any) {
    const templates = payload?.parser_response?.templates
        || payload?.parser_response?.data
        || payload?.templates
        || payload?.data
        || []

    return Array.isArray(templates) ? templates : []
}

export default function SavedRecipesLibrary() {
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [message, setMessage] = useState<string | null>(null)
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)

    const templatesQuery = useQuery({
        queryKey: ['saved_parser_recipes', currentProject?.id],
        queryFn: () => parserApi.listTemplates(currentProject!.id),
        enabled: !!currentProject
    })

    const runTemplate = useMutation({
        mutationFn: (templateId: string) => {
            if (!currentProject?.id) {
                throw new Error('Сначала выбери проект')
            }
            return parserApi.runTemplate(currentProject.id, templateId)
        },
        onSuccess: (result: any, templateId: string) => {
            const jobId = result?.parser_response?.job_id || result?.job_id
            setMessage(`Шаблон ${templateId} поставлен в очередь${jobId ? ` как ${jobId}` : ''}.`)
            queryClient.invalidateQueries({ queryKey: ['parser_job', currentProject?.id] })
            queryClient.invalidateQueries({ queryKey: ['parser_posts', currentProject?.id] })
        }
    })

    const recipes = useMemo(() => parseTemplates(templatesQuery.data), [templatesQuery.data])

    return (
        <div className="flex-1 w-full p-8 lg:p-10 overflow-y-auto">
            <div className="max-w-[1600px] mx-auto space-y-8">
                <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 lg:p-10">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-8">
                        <div className="max-w-4xl">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Библиотека шаблонов</div>
                            <h1 className="mt-3 text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface">
                                Переиспользуемые исследовательские шаблоны проекта
                            </h1>
                            <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                Используй шаблоны как повторяемые discovery-активы. Здесь проект хранит исследовательские playbook до того, как они превратятся в parser jobs, входы каналов или кандидатов на публикацию.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-[320px]">
                            <Link to="/parsers" className="rounded-2xl ai-gradient text-white px-5 py-4 text-sm font-black text-center shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all">
                                Открыть исследования
                            </Link>
                            <Link to="/projects" className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all">
                                Назад к обзору
                            </Link>
                        </div>
                    </div>

                    {message && (
                        <div className="mt-6 rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                            {message}
                        </div>
                    )}
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Шаблоны</div>
                            <h2 className="mt-2 text-2xl font-headline font-black text-on-surface">Переиспользуемые настройки исследований</h2>
                        </div>

                        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
                            {recipes.length > 0 ? recipes.map((recipe: JsonRecord, index: number) => {
                                const recipeId = String(recipe.template_id || recipe.id || recipe.slug || `recipe-${index}`)
                                const recipeName = normalizeText(recipe.name || recipe.title || recipe.template_name || recipeId)
                                const source = normalizeText(recipe.source || recipe.platform || recipe.kind || 'parser')
                                const description = normalizeText(recipe.description || recipe.summary || recipe.intent || 'Переиспользуемый discovery-паттерн для этой контентной системы.')
                                const communities = Array.isArray(recipe.subreddits || recipe.groups || recipe.communities)
                                    ? (recipe.subreddits || recipe.groups || recipe.communities)
                                    : []

                                return (
                                    <div key={recipeId} className="rounded-[1.5rem] bg-surface-container-low p-5 border border-outline-variant/10">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/60">{source}</div>
                                                <div className="mt-2 text-xl font-headline font-black text-on-surface">{recipeName}</div>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setActiveTemplateId(recipeId)
                                                    runTemplate.mutate(recipeId)
                                                }}
                                                disabled={runTemplate.isPending}
                                                className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-primary hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                                            >
                                                {runTemplate.isPending && activeTemplateId === recipeId ? 'Запуск...' : 'Запустить'}
                                            </button>
                                        </div>

                                        <p className="mt-4 text-sm leading-7 text-on-surface-variant">{description}</p>

                                        {communities.length > 0 && (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {communities.slice(0, 5).map((community: string) => (
                                                    <span key={community} className="px-3 py-1 rounded-full bg-white text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                                        {community}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            }) : (
                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 text-sm text-on-surface-variant lg:col-span-2">
                                    Для этого проекта пока не найдено ни одного исследовательского шаблона.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Как использовать</div>
                            <div className="mt-4 space-y-3 text-sm leading-7 text-on-surface-variant">
                                <p>1. Храни здесь повторяемую discovery-логику вместо того, чтобы заново собирать фильтры в каждой исследовательской сессии.</p>
                                <p>2. Запускай шаблон, смотри результаты в исследовательской лаборатории и только потом передавай сильнейшие сигналы в рабочую область канала.</p>
                                <p>3. Используй разные шаблоны для разных ролей сети контента: pain research, разговоры фаундеров, channel-specific trend sweeps или прогрев на gated-платформах.</p>
                            </div>
                        </div>

                        <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Следующая поверхность</div>
                            <Link to="/parsers" className="mt-4 block rounded-[1.5rem] bg-surface-container-low p-5 hover:bg-primary/5 transition-all">
                                <div className="font-headline font-black text-xl text-on-surface">Исследовательская лаборатория</div>
                                <div className="mt-3 text-sm leading-7 text-on-surface-variant">
                                    Открой исследовательскую рабочую область, чтобы смотреть результаты, задавать пороги скоринга и передавать сигналы в каналы проекта.
                                </div>
                            </Link>
                        </div>
                    </div>
                </section>

                {(templatesQuery.isLoading || templatesQuery.error || runTemplate.error) && (
                    <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6 text-sm text-on-surface-variant">
                        {templatesQuery.isLoading
                            ? 'Загружаем шаблоны...'
                            : (templatesQuery.error as Error)?.message || (runTemplate.error as Error)?.message}
                    </section>
                )}
            </div>
        </div>
    )
}
