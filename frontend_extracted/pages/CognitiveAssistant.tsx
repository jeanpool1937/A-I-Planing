import React, { useState, useRef, useEffect } from 'react';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    sql?: string;
    data?: any;
}

export const CognitiveAssistant: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: '¡Hola! Soy tu asistente de PCP. Puedo ayudarte a consultar el stock actual, ver pronósticos de quiebre o analizar anomalías de producción. ¿Qué deseas saber hoy?' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setIsLoading(true);

        try {
            const response = await fetch('http://localhost:8000/cognitive/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: userMessage }),
            });

            const result = await response.json();

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: result.answer,
                sql: result.sql,
                data: result.data
            }]);
        } catch (error) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'Lo siento, hubo un error al conectar con el motor de IA. Por favor, asegúrate de que el backend esté corriendo.'
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)] bg-dark-900 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
            {/* Chat Header */}
            <div className="px-6 py-4 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-700 shadow-lg">
                        <img src="logo_ai.png" alt="AI Assistant" className="w-full h-full object-cover" />
                    </div>
                    <div>
                        <h3 className="text-white font-semibold">A+I Cognitive Assistant</h3>
                        <p className="text-[10px] text-primary-400 font-bold uppercase tracking-widest">Powered by Gemini & RAG</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                    <span className="text-[10px] text-slate-400 font-medium">{isLoading ? 'Procesando...' : 'Online'}</span>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-4 rounded-2xl ${m.role === 'user'
                            ? 'bg-primary-600 text-white rounded-tr-none'
                            : 'bg-slate-800 text-slate-100 border border-slate-700 rounded-tl-none'
                            }`}>
                            <div className="text-sm whitespace-pre-wrap leading-relaxed">
                                {m.content}
                            </div>

                            {m.sql && (
                                <details className="mt-3 bg-dark-950/50 rounded-lg border border-slate-700 overflow-hidden">
                                    <summary className="px-3 py-1.5 text-[10px] text-slate-500 cursor-pointer hover:bg-slate-700/50 transition-colors uppercase font-bold tracking-widest">
                                        Ver Consulta SQL
                                    </summary>
                                    <div className="p-3 bg-dark-950 font-mono text-[11px] text-emerald-400 overflow-x-auto whitespace-pre">
                                        {m.sql}
                                    </div>
                                </details>
                            )}

                            {m.role === 'assistant' && m.data && Array.isArray(m.data) && m.data.length > 0 && (
                                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-700 bg-dark-950/30">
                                    <table className="w-full text-left text-[11px]">
                                        <thead className="bg-slate-800/80 text-slate-400">
                                            <tr>
                                                {Object.keys(m.data[0]).slice(0, 4).map(k => (
                                                    <th key={k} className="px-3 py-2 font-medium">{k}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800">
                                            {m.data.slice(0, 5).map((row, ri) => (
                                                <tr key={ri} className="hover:bg-slate-800/50 transition-colors">
                                                    {Object.values(row).slice(0, 4).map((val: any, vi) => (
                                                        <td key={vi} className="px-3 py-2 text-slate-300">
                                                            {typeof val === 'number' ? val.toLocaleString() : String(val)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-slate-800 p-4 rounded-2xl rounded-tl-none border border-slate-700 flex gap-2">
                            <span className="w-2 h-2 bg-primary-500 rounded-full animate-bounce"></span>
                            <span className="w-2 h-2 bg-primary-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                            <span className="w-2 h-2 bg-primary-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-6 bg-slate-800/30 border-t border-slate-800">
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ej: ¿Qué SKUs tienen el stock más crítico hoy?"
                        className="flex-1 bg-dark-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600 transition-all font-sans"
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="w-12 h-12 rounded-xl bg-primary-600 text-white flex items-center justify-center hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-600/20 active:scale-95"
                    >
                        <span className="material-symbols-rounded">send</span>
                    </button>
                </div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {['Sugerirme algo', 'Quiebres semana', 'Top anomalías'].map(q => (
                        <button
                            key={q}
                            onClick={() => setInput(q)}
                            className="whitespace-nowrap px-3 py-1 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-full text-[11px] text-slate-400 hover:text-white transition-all transition-colors"
                        >
                            {q}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
