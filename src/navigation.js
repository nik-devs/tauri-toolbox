// Навигация по страницам
export function initNavigation() {
    const toolbarBtns = document.querySelectorAll('.toolbar-btn');
    const pages = document.querySelectorAll('.page');
    const utilityOpenBtns = document.querySelectorAll('.utility-open-btn');
    const backToGalleryBtn = document.getElementById('backToGalleryBtn');

    // Обработка кликов по кнопкам тулбара
    toolbarBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetPage = btn.dataset.page;
            
            // Убираем активный класс со всех элементов
            toolbarBtns.forEach(b => b.classList.remove('active'));
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
            const utilityPage = document.getElementById(`page-utility-${utilityId}`);
            
            if (utilityPage) {
                // Скрываем все страницы
                pages.forEach(page => page.classList.remove('active'));
                // Показываем страницу утилиты
                utilityPage.classList.add('active');
            }
        });
    });

    // Обработка кнопки "Назад к утилитам"
    if (backToGalleryBtn) {
        backToGalleryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Скрываем все страницы
            pages.forEach(page => page.classList.remove('active'));
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

