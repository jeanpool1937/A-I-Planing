import React, { useState } from 'react';

export const FloatingAssistant: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<{ role: string; content: string }[]>([
        { role: 'assistant', content: '¿En qué puedo ayudarte rápidamente?' }
    ]);
    const [isLoading, setIsLoading] = useState(false);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const userMsg = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsLoading(true);

        try {
            const resp = await fetch('http://localhost:8000/cognitive/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: userMsg }),
            });
            const data = await resp.json();
            setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Backend desconectado.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {isOpen && (
                <div className="mb-4 w-80 h-96 bg-dark-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="p-4 bg-primary-600 text-white flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full overflow-hidden border border-white/20">
                                <img src="logo_ai.png" alt="AI" className="w-full h-full object-cover" />
                            </div>
                            <span className="font-bold text-sm">Quick Assist</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 rounded-full p-1 transition-colors">
                            <span className="material-symbols-rounded">close</span>
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs scrollbar-thin">
                        {messages.map((m, i) => (
                            <div key={i} className={`p-3 rounded-xl ${m.role === 'user' ? 'bg-primary-600 text-white ml-8' : 'bg-slate-800 text-slate-300 mr-8'}`}>
                                {m.content}
                            </div>
                        ))}
                        {isLoading && <div className="text-slate-500 animate-pulse text-[10px]">IA pensando...</div>}
                    </div>
                    <div className="p-3 border-t border-slate-700 flex gap-2">
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && handleSend()}
                            placeholder="Pregunta algo..."
                            className="flex-1 bg-dark-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary-600"
                        />
                        <button onClick={handleSend} className="bg-primary-600 text-white p-2 rounded-lg hover:bg-primary-500 transition-colors">
                            <span className="material-symbols-rounded text-sm">send</span>
                        </button>
                    </div>
                </div>
            )}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-xl hover:bg-primary-500 hover:scale-110 active:scale-95 transition-all duration-300 group"
            >
                {isOpen ? (
                    <span className="material-symbols-rounded text-2xl">close</span>
                ) : (
                    <img src="logo_ai.png" alt="AI Assistant" className="w-8 h-8 object-contain group-hover:rotate-12 transition-transform" />
                )}
                {!isOpen && (
                    <div className="absolute right-16 px-3 py-2 bg-slate-800 text-white text-[10px] font-bold rounded-lg border border-slate-700 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none uppercase tracking-widest">
                        ¿Necesitas ayuda?
                    </div>
                )}
            </button>
        </div>
    );
};
