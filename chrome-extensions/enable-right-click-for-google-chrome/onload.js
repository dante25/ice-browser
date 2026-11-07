 window.inject_xxx_777 = true;
window.addEventListener("contextmenu", 
  function(e){

    e.stopPropagation()
}, true);

 document.addEventListener('contextmenu', function (e) {
    e.stopPropagation();
}, true);
