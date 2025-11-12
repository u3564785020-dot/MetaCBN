<?php
/**
 * Правильный скрипт - отключает ТОЛЬКО футер, не трогая основные кнопки
 */

$htmlFile = 'Meta Pay _ Meta.html';

if (!file_exists($htmlFile)) {
    die("Файл $htmlFile не найден!\n");
}

// Читаем HTML файл
$html = file_get_contents($htmlFile);

// Удаляем ВСЕ старые блокирующие стили и скрипты (если есть)
$html = preg_replace('/<style[^>]*id=["\']footer-disable[^"\']*["\'][^>]*>.*?<\/style>/s', '', $html);
$html = preg_replace('/<script[^>]*>[\s\S]*?disableFooterLinks[\s\S]*?<\/script>/s', '', $html);
$html = preg_replace('/<script[^>]*>[\s\S]*?disableOnlyFooter[\s\S]*?<\/script>/s', '', $html);

// Простое и безопасное решение - только JavaScript, который точно определяет футер
$footerDisableJS = '
<script>
(function() {
    function disableFooterOnly() {
        // Находим все ссылки
        var links = document.querySelectorAll("a[href]");
        var documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        
        // Точные ключевые слова футера
        var footerTexts = [
            "Privacy Policy", "Terms of Service", "Cookie Policy", 
            "Community Standards", "About Meta", "Careers", "Newsroom",
            "Facebook Help Center", "Instagram Help Center", "WhatsApp Help Center",
            "Messenger Help Center", "Workplace Help Center", "Meta Verified",
            "Meta Store", "Meta Quest", "Ray-Ban Meta", "Accessories",
            "Apps and games", "Meta Quest gift cards", "Refurbished",
            "Meta Warranty Plus", "Meta for Work", "Meta for Education",
            "Creators", "Developers", "Businesses", "Non-profits",
            "Download SDKs", "Made for Meta", "VR for Good",
            "Data and privacy", "Responsible business practices", "Elections",
            "Media gallery", "Brand resources", "For investors",
            "Order status", "Returns", "Find a product demo",
            "Authorized retailers", "Terms of sale", "Meta Quest safety center"
        ];
        
        links.forEach(function(link) {
            var linkText = (link.textContent || "").trim();
            var href = (link.href || link.getAttribute("href") || "").toLowerCase();
            var rect = link.getBoundingClientRect();
            var linkTop = rect.top + window.scrollY;
            
            // Проверяем, что это ссылка футера по тексту
            var isFooterText = footerTexts.some(function(text) {
                return linkText === text || linkText.includes(text);
            });
            
            // Проверяем URL - должен содержать типичные пути футера
            var isFooterUrl = href.includes("/help") || 
                             href.includes("/privacy") ||
                             href.includes("/terms") ||
                             href.includes("/cookie") ||
                             href.includes("/legal") ||
                             href.includes("/about") ||
                             href.includes("/careers") ||
                             href.includes("/newsroom") ||
                             (href.includes("facebook.com") && (href.includes("/policies") || href.includes("/help"))) ||
                             (href.includes("meta.com") && (href.includes("/help") || href.includes("/about")));
            
            // Проверяем позицию - должна быть в нижних 20% страницы
            var isInBottom = linkTop > documentHeight * 0.8;
            
            // Отключаем ТОЛЬКО если это точно ссылка футера (по тексту ИЛИ URL) И внизу страницы
            if ((isFooterText || isFooterUrl) && isInBottom) {
                link.style.pointerEvents = "none";
                link.style.cursor = "default";
                link.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                };
            }
        });
    }
    
    // Запускаем после загрузки DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", disableFooterOnly);
    } else {
        disableFooterOnly();
    }
    
    // Также запускаем после полной загрузки
    window.addEventListener("load", function() {
        setTimeout(disableFooterOnly, 1000);
    });
})();
</script>
';

// Вставляем JavaScript перед закрывающим тегом </body>
if (strpos($html, '</body>') !== false) {
    $html = str_replace('</body>', $footerDisableJS . '</body>', $html);
} else {
    $html .= $footerDisableJS;
}

// Сохраняем
file_put_contents($htmlFile, $html);

echo "Готово! Теперь блокируется ТОЛЬКО футер.\n";
echo "Все основные кнопки и ссылки работают нормально.\n";
echo "Файл $htmlFile обновлен.\n";
?>

