export function headerEntries(headers){
  if(!headers) return [];
  if(headers instanceof Headers) return [...headers.entries()];
  if(typeof headers[Symbol.iterator]==='function') return [...headers].flatMap(([key,value])=>{
    if(Array.isArray(value)) return value.map(item=>[String(key),String(item)]);
    if(value === undefined || value === null) return [];
    return [[String(key),String(value)]];
  });
  if(typeof headers==='object'){
    return Object.entries(headers).flatMap(([key,value])=>{
      if(Array.isArray(value)) return value.map(item=>[key,String(item)]);
      if(value === undefined || value === null) return [];
      return [[key,String(value)]];
    });
  }
  return [];
}

export function headerRecord(headers){
  const record={};
  for(const [key,value] of headerEntries(headers)){
    const lower=String(key).toLowerCase();
    if(record[lower] === undefined) record[lower]=value;
    else if(Array.isArray(record[lower])) record[lower].push(value);
    else record[lower]=[record[lower],value];
  }
  return record;
}
