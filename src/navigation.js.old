// Навигация по страницам
let aiTabsCounter = 0;
const aiTabs = new Map(); // Map для хранения вкладок: tabId -> { utilityId, pageElement }

export function initNavigation() {
    const toolbarBtns = document.querySelectorAll('.toolbar-btn');
    const pages = document.querySelectorAll('.page');
    const utilityOpenBtns = document.querySelectorAll('.utility-open-btn');
    const backToGalleryBtn = document.getElementById('backToGalleryBtn');
    const aiTabsContainer = document.getElementById('aiTabsContainer');

    // Обработка кликов по кнопкам тулбара
    toolbarBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetPage = btn.dataset.page;
            
            // Убираем активный класс со всех элементов
            toolbarBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.toolbar-tab').forEach(tab => tab.classList.remove('active'));
            pages.forEach(page => page.classList.remove('active'));
            
            // Добавляем активный класс к выбранному элементу
            btn.classList.add('active');
            const page = document.getElementById(`page-${targetPage}`);
            if (page) {
                page.classList.add('active');
            }
        });
    });

    // Обработка открытия утилит из галереи
    utilityOpenBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const utilityId = btn.dataset.utility;
            const utilityCard = btn.closest('.utility-card');
            const parentPage = utilityCard?.closest('.page');
            
            // Определяем, к какой категории относится утилита
            const isAiUtility = parentPage?.id === 'page-ai';
            
            if (isAiUtility) {
                // Для AI утилит создаем вкладку
                openAiUtilityTab(utilityId, aiTabsContainer);
            } else {
                // Для обычных утилит - стандартное поведение
                const utilityPage = document.getElementById(`page-utility-${utilityId}`);
                if (utilityPage) {
                    // Скрываем все страницы
                    pages.forEach(page => page.classList.remove('active'));
                    document.querySelectorAll('.toolbar-tab').forEach(tab => tab.classList.remove('active'));
                    // Показываем страницу утилиты
                    utilityPage.classList.add('active');
                    
                    // Активируем кнопку "Утилиты" в тулбаре
                    toolbarBtns.forEach(tb => {
                        if (tb.dataset.page === 'tools') {
                            tb.classList.add('active');
                        } else {
                            tb.classList.remove('active');
                        }
                    });
                }
            }
        });
    });

    // Обработка кнопки "Назад к утилитам"
    if (backToGalleryBtn) {
        backToGalleryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Скрываем все страницы
            pages.forEach(page => page.classList.remove('active'));
            document.querySelectorAll('.toolbar-tab').forEach(tab => tab.classList.remove('active'));
            // Показываем галерею утилит
            const toolsPage = document.getElementById('page-tools');
            if (toolsPage) {
                toolsPage.classList.add('active');
            }
            // Активируем кнопку "Утилиты" в тулбаре
            toolbarBtns.forEach(btn => {
                if (btn.dataset.page === 'tools') {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        });
    }
}

// Функция для открытия AI утилиты как вкладки
function openAiUtilityTab(utilityId, container) {
    // Создаем уникальный ID для вкладки
    const tabId = `ai-tab-${utilityId}-${++aiTabsCounter}`;
    
    // Клонируем страницу утилиты
    const originalPage = document.getElementById(`page-utility-${utilityId}`);
    if (!originalPage) {
        console.error(`Страница утилиты ${utilityId} не найдена`);
        return;
    }
    
    // Создаем клон страницы
    const clonedPage = originalPage.cloneNode(true);
    clonedPage.id = tabId;
    clonedPage.classList.add('ai-tab-page');
    clonedPage.classList.remove('utility-page');
    
    // Исправляем ID всех элементов внутри клона, чтобы избежать конфликтов
    const allElements = clonedPage.querySelectorAll('[id]');
    allElements.forEach(el => {
        if (el.id) {
            el.id = `${el.id}-${tabId}`;
        }
    });
    
    // Обновляем for атрибуты в label
    const labels = clonedPage.querySelectorAll('label[for]');
    labels.forEach(label => {
        if (label.getAttribute('for')) {
            const oldFor = label.getAttribute('for');
            label.setAttribute('for', `${oldFor}-${tabId}`);
        }
    });
    
    // Добавляем страницу в DOM (скрытую)
    document.querySelector('.main-content').appendChild(clonedPage);
    
    // Получаем название утилиты
    const utilityTitle = originalPage.querySelector('.utility-header h2')?.textContent || utilityId;
    
    // Создаем вкладку
    const tab = document.createElement('button');
    tab.className = 'toolbar-tab active';
    tab.dataset.tabId = tabId;
    tab.innerHTML = `
        <span>${utilityTitle}</span>
        <button class="toolbar-tab-close" data-tab-id="${tabId}">✕</button>
    `;
    
    // Обработчик клика на вкладку
    tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('toolbar-tab-close')) {
            return; // Закрытие обрабатывается отдельно
        }
        
        // Активируем вкладку
        document.querySelectorAll('.toolbar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.querySelectorAll('.ai-tab-page').forEach(page => page.classList.remove('active'));
        
        tab.classList.add('active');
        clonedPage.classList.add('active');
    });
    
    // Обработчик закрытия вкладки
    const closeBtn = tab.querySelector('.toolbar-tab-close');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAiUtilityTab(tabId, tab, clonedPage);
    });
    
    // Добавляем вкладку в контейнер
    container.appendChild(tab);
    
    // Сохраняем информацию о вкладке
    aiTabs.set(tabId, {
        utilityId,
        pageElement: clonedPage,
        tabElement: tab
    });
    
    // Инициализируем утилиту для клонированной страницы
    if (utilityId === 'upscale') {
        import('./upscale.js').then(({ initUpscaleForPage }) => {
            initUpscaleForPage(clonedPage);
        });
    }
    
    // Активируем вкладку
    tab.click();
}

// Функция для закрытия AI утилиты
function closeAiUtilityTab(tabId, tabElement, pageElement) {
    // Удаляем вкладку из DOM
    if (tabElement && tabElement.parentNode) {
        tabElement.parentNode.removeChild(tabElement);
    }
    
    // Удаляем страницу из DOM
    if (pageElement && pageElement.parentNode) {
        pageElement.parentNode.removeChild(pageElement);
    }
    
    // Удаляем из Map
    aiTabs.delete(tabId);
    
    // Если это была активная вкладка, показываем галерею AI
    if (tabElement && tabElement.classList.contains('active')) {
        const aiPage = document.getElementById('page-ai');
        const aiBtn = document.querySelector('.toolbar-btn[data-page="ai"]');
        
        if (aiPage && aiBtn) {
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
            document.querySelectorAll('.toolbar-tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.toolbar-btn').forEach(btn => btn.classList.remove('active'));
            
            aiPage.classList.add('active');
            aiBtn.classList.add('active');
        }
    }
}

