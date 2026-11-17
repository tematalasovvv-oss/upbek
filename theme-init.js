// Тема выставляется до отрисовки страницы (отдельный файл, чтобы политика безопасности запрещала любые встроенные скрипты)
try { document.documentElement.dataset.theme = localStorage.getItem('upbek.theme') || 'classic'; } catch (e) { document.documentElement.dataset.theme = 'classic'; }
