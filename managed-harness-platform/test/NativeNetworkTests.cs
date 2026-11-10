using System;
static class NativeNetworkTests {
    static int Main(){
        int checks=0;
        string[,] valid={{"https://MANAGER.example:443/","https://manager.example"},{"https://manager.example:9443","https://manager.example:9443"},{"https://192.168.1.118:7443/","https://192.168.1.118:7443"}};
        for(int i=0;i<valid.GetLength(0);i++){if(NetworkAddress.Origin(valid[i,0])!=valid[i,1])throw new Exception("Origin normalization failed");checks++;}
        foreach(string input in new[]{"http://manager.example","https://user:password@manager.example","https://manager.example/api","https://manager.example?server=other","https://manager.example#fragment","https://manager.example:65536"}){
            bool denied=false;try{NetworkAddress.Origin(input);}catch(ArgumentException){denied=true;}if(!denied)throw new Exception("Invalid origin was accepted");checks++;
        }
        Console.WriteLine("{\"nativeNetworkChecks\":"+checks+",\"pass\":true}");return 0;
    }
}
